using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;

namespace Rankflix.Services;

public interface ISseService
{
    ChannelReader<string> Subscribe(int userId, string status, out Guid subscriptionId);
    void Unsubscribe(int userId, Guid subscriptionId);
    void UpdateStatus(int userId, string status);
    void Publish(int userId, string eventName, object payload);
    void PublishToUsers(IEnumerable<int> userIds, string eventName, object payload);
    bool IsOnline(int userId);
    IReadOnlyCollection<int> GetOnlineUserIds();
}

/// <summary>
/// In-memory pub/sub for the real-time event stream (see EventsController). Each connected
/// browser tab holds one Channel; publishing writes a pre-formatted SSE message into every
/// channel belonging to the target user(s). This is single-instance only (no backplane) -
/// fine for this app's self-hosted single-container deployment, but note it won't fan out
/// across multiple API instances if that ever changes.
/// </summary>
public class SseService : ISseService
{
    private readonly ConcurrentDictionary<int, ConcurrentDictionary<Guid, Channel<string>>> _subscribers = new();

    // Mirrors each connected user's "status" preference (online/invisible) for as long as
    // they're connected, so we know whether to broadcast them as online or keep them hidden.
    private readonly ConcurrentDictionary<int, string> _statusByUser = new();
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public ChannelReader<string> Subscribe(int userId, string status, out Guid subscriptionId)
    {
        subscriptionId = Guid.NewGuid();
        var channel = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
        var userChannels = _subscribers.GetOrAdd(userId, _ => new ConcurrentDictionary<Guid, Channel<string>>());
        var wasOffline = userChannels.IsEmpty;
        userChannels[subscriptionId] = channel;
        _statusByUser[userId] = status;

        // First tab/connection for this user - tell everyone currently connected that they
        // just came online (subsequent tabs from the same user don't re-announce). Skipped
        // entirely if their preference is "invisible" - they should appear offline to others.
        if (wasOffline && status != "invisible") BroadcastPresence(userId, online: true);

        return channel.Reader;
    }

    public void Unsubscribe(int userId, Guid subscriptionId)
    {
        if (!_subscribers.TryGetValue(userId, out var userChannels)) return;

        if (userChannels.TryRemove(subscriptionId, out var channel))
            channel.Writer.TryComplete();

        if (userChannels.IsEmpty)
        {
            _subscribers.TryRemove(userId, out _);
            var wasVisible = _statusByUser.TryRemove(userId, out var status) && status != "invisible";
            // A real disconnect always forces offline, regardless of their saved preference.
            if (wasVisible) BroadcastPresence(userId, online: false);
        }
    }

    public void UpdateStatus(int userId, string status)
    {
        if (!_subscribers.ContainsKey(userId)) return; // not connected - nothing to broadcast right now

        var previous = _statusByUser.GetValueOrDefault(userId, "online");
        _statusByUser[userId] = status;

        if (previous == status) return;
        BroadcastPresence(userId, online: status != "invisible");
    }

    public void Publish(int userId, string eventName, object payload) => PublishToUsers([userId], eventName, payload);

    public void PublishToUsers(IEnumerable<int> userIds, string eventName, object payload)
    {
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        var message = $"event: {eventName}\ndata: {json}\n\n";

        foreach (var userId in userIds.Distinct())
        {
            if (!_subscribers.TryGetValue(userId, out var userChannels)) continue;
            foreach (var channel in userChannels.Values)
                channel.Writer.TryWrite(message);
        }
    }

    public bool IsOnline(int userId) =>
        _subscribers.ContainsKey(userId) && _statusByUser.GetValueOrDefault(userId, "online") != "invisible";

    public IReadOnlyCollection<int> GetOnlineUserIds() =>
        _subscribers.Keys.Where(IsOnline).ToList();

    private void BroadcastPresence(int userId, bool online)
    {
        // Broadcast to every currently-connected user (this is a small, private friend-group
        // app - there's no per-group scoping of presence, everyone can see everyone's status).
        PublishToUsers(_subscribers.Keys, "presence-changed", new { userId, online });
    }
}
