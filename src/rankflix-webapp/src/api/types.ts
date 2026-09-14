export interface LoginResponse {
  accessToken: string;
  expireMinutes: number;
}

export interface UserProfile {
  id: number;
  displayName: string;
  avatarUrl: string | null;
  discordId: string | null;
  role: "admin" | "member";
  status: "online" | "invisible";
}

export type UserListItem = UserProfile;

export interface UserDirectoryItem {
  id: number;
  displayName: string;
  avatarUrl: string | null;
}

export interface GroupMember {
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  discordId: string | null;
  isOwner: boolean;
}

export interface PendingGroupMember {
  discordId: string;
  displayName: string | null;
}

export interface Group {
  id: number;
  name: string;
  ownerId: number;
  imageUrl: string | null;
  members: GroupMember[];
  pendingMembers: PendingGroupMember[];
}

export interface Watcher {
  userId: number | null;
  displayName: string;
  avatarUrl?: string | null;
  hasWatched: boolean;
  rating: number | null;
  comment: string | null;
  ratedAt?: string | null;
  isPending?: boolean;
  discordId?: string | null;
}

export interface GroupMedia {
  tmdbId: number;
  title: string;
  type: string;
  posterUrl: string | null;
  addedAt: string;
  votingDurationHours: number;
  votingClosesAt: string;
  votingOpen: boolean;
  averageRating: number | null;
  watchers: Watcher[];
  runtimeMinutes?: number | null;
  genre?: string | null;
  year?: number | null;
}

export interface ExcelImportResult {
  mediaImported: number;
  reviewsImported: number;
  watchStatusesImported: number;
  unmatchedDiscordIds: string[];
  mediaRemoved: number;
}

export interface MediaSearchResult {
  tmdbId: number;
  title: string;
  type: string;
  year: string | null;
  posterUrl: string | null;
}

export interface TopMedia {
  tmdbId: number;
  title: string;
  posterUrl: string | null;
  rating: number;
}

export interface UserStats {
  totalGroups: number;
  moviesWatched: number;
  tvWatched: number;
  totalRatingsGiven: number;
  averageRatingGiven: number | null;
  topRated: TopMedia | null;
}

export interface MemberStats {
  userId: number;
  displayName: string;
  avatarUrl: string | null;
  discordId: string | null;
  moviesWatched: number;
  tvWatched: number;
  totalRatingsGiven: number;
  averageRatingGiven: number | null;
  watchTimeMinutes: number;
}

export interface PendingMemberStats {
  discordId: string;
  displayName: string | null;
  moviesWatched: number;
  tvWatched: number;
  totalRatingsGiven: number;
  averageRatingGiven: number | null;
  watchTimeMinutes: number;
}

export interface TopMediaInGroup {
  tmdbId: number;
  title: string;
  posterUrl: string | null;
  averageRating: number;
}

export interface GroupStats {
  members: MemberStats[];
  pendingMembers: PendingMemberStats[];
  topMedia: TopMediaInGroup | null;
  totalWatchTimeMinutes: number;
}
