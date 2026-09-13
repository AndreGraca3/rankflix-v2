import { useState } from "react";
import { api } from "../api/client";
import type { Group } from "../api/types";
import { ImageUploadButton } from "./ImageUploadButton";

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
export function GroupEditForm({
  group,
  onSaved,
  onError,
  onCancel,
  onDeleteRequested,
}: {
  group: Group;
  // Called immediately (optimistically), before the server confirms the save, with the
  // new name/imageUrl so the caller can update its own view right away.
  onSaved: (patch: { name: string; imageUrl: string | null }) => void;
  // Called if the save turns out to have failed after onSaved already ran - the caller
  // should revert its optimistic update (e.g. by refetching) and surface the error.
  onError?: (message: string) => void;
  onCancel: () => void;
  onDeleteRequested?: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [imageUrl, setImageUrl] = useState(group.imageUrl ?? "");

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const trimmedName = name.trim();
    const trimmedImageUrl = imageUrl.trim() || null;

    // Optimistic: hand the new values to the caller right away (it typically closes this
    // form/modal immediately) instead of waiting on the network round-trip.
    onSaved({ name: trimmedName, imageUrl: trimmedImageUrl });

    api.patch(`/api/groups/${group.id}`, { name: trimmedName, imageUrl: trimmedImageUrl }).catch((err) => {
      onError?.(err instanceof Error ? err.message : "Failed to update group");
    });
  };

  return (
    <form className="group-edit-form" onClick={(e) => e.stopPropagation()} onSubmit={save}>
      <h2>Edit group</h2>
      <div className="group-edit-poster-row">
        <GroupPosterEditor imageUrl={imageUrl} name={name} onChange={setImageUrl} />
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />
      <div className="row group-edit-actions">
        <button type="submit">Save</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {onDeleteRequested && (
        <button type="button" className="danger group-delete-btn" onClick={onDeleteRequested}>
          Delete group
        </button>
      )}
    </form>
  );
}
