import { useState } from "react";
import { api } from "../api/client";
import type { Group } from "../api/types";
import { ImageUploadButton } from "./ImageUploadButton";
import { Toast } from "./Toast";

export function GroupPoster({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  if (imageUrl) {
    return <img className="group-poster" src={imageUrl} alt={name} />;
  }
  return (
    <div className="group-poster group-poster-fallback">
      <img src="/favicon.svg" alt="" />
    </div>
  );
}

export function GroupPosterEditor({
  imageUrl,
  name,
  onChange,
}: {
  imageUrl: string;
  name: string;
  onChange: (imageUrl: string) => void;
}) {
  return (
    <div className="group-poster-edit-wrap">
      <GroupPoster imageUrl={imageUrl || null} name={name || "Group"} />
      <ImageUploadButton
        label="Change poster"
        onImage={onChange}
        renderTrigger={(open, loading) => (
          <button type="button" className="group-poster-edit-overlay" onClick={open} disabled={loading} title="Change poster">
            {loading ? "…" : "✎"}
          </button>
        )}
      />
      {imageUrl && (
        <button
          type="button"
          className="group-poster-remove-overlay"
          onClick={() => onChange("")}
          title="Remove poster"
        >
          🗑
        </button>
      )}
    </div>
  );
}

// Shared by DashboardPage's grid-card edit modal and GroupPage's header edit modal.
// The backend broadcasts a "group-updated" SSE event on save, so any other open tab/user
// viewing this group (or the Dashboard) picks up the new name/poster live, without needing
// a manual callback wired through here.
export function GroupEditForm({ group, onSaved, onCancel }: { group: Group; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(group.name);
  const [imageUrl, setImageUrl] = useState(group.imageUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/groups/${group.id}`, { name: name.trim(), imageUrl: imageUrl.trim() || null });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update group");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="group-edit-form" onClick={(e) => e.stopPropagation()} onSubmit={save}>
      <h2>Edit group</h2>
      <div className="group-edit-poster-row">
        <GroupPosterEditor imageUrl={imageUrl} name={name} onChange={setImageUrl} />
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
      <div className="row group-edit-actions">
        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <Toast variant="error" title={error} duration={7000} onClose={() => setError(null)} />}
    </form>
  );
}
