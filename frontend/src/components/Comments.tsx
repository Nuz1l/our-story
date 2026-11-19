import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Heart,
  MessageCircle,
  Send,
  Trash2,
  Pencil,
  ChevronDown,
} from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { Comment, Page, User } from "../lib/types";

function dateText(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

function CommentForm({
  postId,
  parentId,
  onDone,
  placeholder,
}: {
  postId: string;
  parentId?: string;
  onDone?: () => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/posts/${postId}/comments`, {
        content: value.trim(),
        parent_id: parentId || null,
      });
      setValue("");
      onDone?.();
      queryClient.invalidateQueries({ queryKey: ["comments", postId] });
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="comment-form" onSubmit={submit}>
      <div className="comment-input-row">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={3000}
          rows={2}
          placeholder={placeholder || "Поделитесь мыслью…"}
          aria-label="Текст комментария"
        />
        <button
          className="icon-button send-button"
          type="submit"
          disabled={busy || !value.trim()}
          aria-label="Отправить комментарий"
        >
          <Send size={18} />
        </button>
      </div>
      {error && <small className="field-error">{error}</small>}
    </form>
  );
}

function CommentNode({
  comment,
  postId,
  user,
  depth,
}: {
  comment: Comment;
  postId: string;
  user?: User;
  depth: number;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [replyLimit, setReplyLimit] = useState(20);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(comment.content);
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();
  const replies = useQuery({
    queryKey: ["comments", postId, comment.id, replyLimit],
    queryFn: () =>
      api
        .get<Page<Comment>>(`/posts/${postId}/comments`, {
          params: { parent_id: comment.id, limit: replyLimit },
        })
        .then((r) => r.data),
    enabled: expanded,
  });
  async function mutate(method: "post" | "delete", path: string) {
    setMessage("");
    try {
      await api[method](path);
      queryClient.invalidateQueries({ queryKey: ["comments", postId] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  async function saveEdit() {
    try {
      await api.patch(`/comments/${comment.id}`, { content: edited });
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["comments", postId] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  async function remove() {
    if (!window.confirm("Удалить комментарий?")) return;
    await mutate("delete", `/comments/${comment.id}`);
  }
  return (
    <div className={`comment-node depth-${Math.min(depth, 3)}`}>
      <span className="comment-avatar">
        {comment.author_name.charAt(0).toUpperCase()}
      </span>
      <div className="comment-body">
        <div className="comment-head">
          <strong>{comment.author_name}</strong>
          <time>{dateText(comment.created_at)}</time>
          {comment.moderation_status === "pending" && (
            <span className="tiny-badge">На проверке</span>
          )}
        </div>
        {editing ? (
          <div className="edit-comment">
            <textarea
              value={edited}
              onChange={(e) => setEdited(e.target.value)}
            />
            <button className="button primary small" onClick={saveEdit}>
              Сохранить
            </button>
            <button
              className="button ghost small"
              onClick={() => setEditing(false)}
            >
              Отмена
            </button>
          </div>
        ) : (
          <p className="comment-text">{comment.content}</p>
        )}
        <div className="comment-actions">
          {user && (
            <button
              onClick={() =>
                mutate(
                  comment.liked ? "delete" : "post",
                  `/comments/${comment.id}/like`,
                )
              }
            >
              <Heart size={14} fill={comment.liked ? "currentColor" : "none"} />{" "}
              {comment.likes_count || "Нравится"}
            </button>
          )}
          {user && depth < 8 && (
            <button onClick={() => setReplyOpen(!replyOpen)}>
              <MessageCircle size={14} /> Ответить
            </button>
          )}
          {comment.can_edit && (
            <>
              <button title="Изменить" onClick={() => setEditing(true)}>
                <Pencil size={14} />
              </button>
              <button title="Удалить" onClick={remove}>
                <Trash2 size={14} />
              </button>
            </>
          )}
          {comment.replies_count > 0 && (
            <button
              className="replies-toggle"
              onClick={() => setExpanded(!expanded)}
            >
              <ChevronDown size={14} className={expanded ? "rotated" : ""} />{" "}
              {comment.replies_count} ответов
            </button>
          )}
        </div>
        {message && <small className="field-error">{message}</small>}
        {replyOpen && (
          <CommentForm
            postId={postId}
            parentId={comment.id}
            onDone={() => {
              setReplyOpen(false);
              setExpanded(true);
            }}
            placeholder={`Ответить ${comment.author_name}…`}
          />
        )}
        {expanded && (
          <div className="replies">
            {replies.isLoading && (
              <p className="muted tiny">Загружаем ответы…</p>
            )}
            {replies.data?.items.map((reply) => (
              <CommentNode
                key={reply.id}
                comment={reply}
                postId={postId}
                user={user}
                depth={depth + 1}
              />
            ))}
            {replies.data && replies.data.total > replyLimit && (
              <button
                className="text-link load-more-comments"
                onClick={() => setReplyLimit((value) => value + 20)}
              >
                Показать ещё ответы
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Comments({ postId, user }: { postId: string; user?: User }) {
  const [limit, setLimit] = useState(20);
  const comments = useQuery({
    queryKey: ["comments", postId, "root", limit],
    queryFn: () =>
      api
        .get<Page<Comment>>(`/posts/${postId}/comments`, { params: { limit } })
        .then((r) => r.data),
  });
  return (
    <div className="comments-panel">
      <h3>
        Комментарии <span>{comments.data?.total ?? ""}</span>
      </h3>
      {user && <CommentForm postId={postId} />}
      {!user && (
        <p className="muted tiny">Войдите, чтобы оставить комментарий.</p>
      )}
      {comments.isLoading && (
        <p className="muted tiny">Загружаем комментарии…</p>
      )}
      {comments.data?.items.length === 0 && (
        <p className="muted tiny">Пока нет комментариев. Можно стать первым.</p>
      )}
      {comments.data?.items.map((comment) => (
        <CommentNode
          key={comment.id}
          comment={comment}
          postId={postId}
          user={user}
          depth={0}
        />
      ))}
      {comments.data && comments.data.total > limit && (
        <button
          className="text-link load-more-comments"
          onClick={() => setLimit((value) => value + 20)}
        >
          Показать ещё комментарии
        </button>
      )}
    </div>
  );
}
