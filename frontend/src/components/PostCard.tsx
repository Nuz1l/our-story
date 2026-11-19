import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Share2,
  Link2,
  Copy,
  Pin,
} from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { Post, User } from "../lib/types";
import { Comments } from "./Comments";

function formatted(date: string | null) {
  return date
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(date))
    : "";
}
function published(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function PostCard({
  post,
  user,
  full = false,
}: {
  post: Post;
  user?: User;
  full?: boolean;
}) {
  const queryClient = useQueryClient();
  const [index, setIndex] = useState(0);
  const [liked, setLiked] = useState(post.liked);
  const [bookmarked, setBookmarked] = useState(post.bookmarked);
  const [likes, setLikes] = useState(post.likes_count);
  const [showComments, setShowComments] = useState(full);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => {
    setLiked(post.liked);
    setBookmarked(post.bookmarked);
    setLikes(post.likes_count);
  }, [post]);
  const media = post.media[index];
  async function toggleLike() {
    if (!user) {
      setToast("Войдите, чтобы поставить отметку");
      return;
    }
    const before = liked;
    setLiked(!before);
    setLikes((count) => (count === null ? null : count + (before ? -1 : 1)));
    try {
      await api[before ? "delete" : "post"](`/posts/${post.id}/like`);
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["post", post.id] });
    } catch (err) {
      setLiked(before);
      setLikes(post.likes_count);
      setToast(errorMessage(err));
    }
  }
  async function toggleBookmark() {
    if (!user) {
      setToast("Войдите, чтобы сохранить");
      return;
    }
    const before = bookmarked;
    setBookmarked(!before);
    try {
      await api[before ? "delete" : "post"](`/posts/${post.id}/bookmark`);
      queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    } catch (err) {
      setBookmarked(before);
      setToast(errorMessage(err));
    }
  }
  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setToast(message);
    } catch {
      setToast("Не удалось скопировать");
    }
    setMenu(false);
  }
  async function share() {
    const url = `${location.origin}/posts/${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: post.title || "Наше воспоминание",
          url,
        });
      } catch {
        /* User canceled. */
      }
    } else await copy(url, "Ссылка скопирована");
  }
  return (
    <article className="post-card" id={`post-${post.id}`}>
      <div className="post-thread-rail">
        <span className="post-avatar">
          {post.author.avatar_url ? (
            <img src={post.author.avatar_url} alt="" />
          ) : (
            post.author.display_name.charAt(0)
          )}
        </span>
        <span className="rail-line" />
      </div>
      <div className="post-main">
        <div className="post-top">
          <div>
            <div className="post-author-line">
              <strong>{post.author.display_name}</strong>
              {post.coauthor && (
                <>
                  <span className="and">&</span>
                  <strong>{post.coauthor.display_name}</strong>
                </>
              )}
              {post.is_pinned && <Pin size={14} className="pin" />}
            </div>
            <span className="handle">
              @{post.author.username} ·{" "}
              {published(post.published_at || post.created_at)}
            </span>
          </div>
          <div className="post-menu-wrap">
            <button
              className="icon-button"
              aria-label="Действия с публикацией"
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={20} />
            </button>
            {menu && (
              <div className="post-menu">
                <button
                  onClick={() =>
                    copy(
                      `${location.origin}/posts/${post.id}`,
                      "Ссылка скопирована",
                    )
                  }
                >
                  <Link2 size={15} /> Скопировать ссылку
                </button>
                {post.quote_enabled && (
                  <button
                    onClick={() => copy(post.content, "Текст скопирован")}
                  >
                    <Copy size={15} /> Скопировать текст
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        {post.event_date && (
          <span className="moment-date">
            {formatted(post.event_date)}
            {post.event_time ? ` · ${post.event_time.slice(0, 5)}` : ""}
          </span>
        )}
        {post.title && (
          <h2 className="post-title">
            <Link to={`/posts/${post.id}`}>{post.title}</Link>
          </h2>
        )}
        <p className="post-content">{post.content}</p>
        {post.location && (
          <p className="post-location">
            <MapPin size={14} /> {post.location}
          </p>
        )}
        {post.media.length > 0 && (
          <div className="post-media">
            {media.media_type === "video" ? (
              <video src={media.url} controls playsInline />
            ) : (
              <img
                src={media.url}
                alt={media.alt_text || post.title || "Фото воспоминания"}
                loading="lazy"
              />
            )}
            {post.media.length > 1 && (
              <>
                <button
                  className="media-prev"
                  aria-label="Предыдущее фото"
                  onClick={() =>
                    setIndex(
                      (index - 1 + post.media.length) % post.media.length,
                    )
                  }
                >
                  <ChevronLeft />
                </button>
                <button
                  className="media-next"
                  aria-label="Следующее фото"
                  onClick={() => setIndex((index + 1) % post.media.length)}
                >
                  <ChevronRight />
                </button>
                <div className="media-count">
                  {index + 1} / {post.media.length}
                </div>
              </>
            )}
          </div>
        )}
        {(post.tags.length > 0 ||
          post.categories.length > 0 ||
          post.mentions.length > 0) && (
          <div className="post-tags">
            {post.categories.map((c) => (
              <span key={c.id} className="category-tag">
                {c.name}
              </span>
            ))}
            {post.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
            {post.mentions?.map((profile) => (
              <span key={profile.id}>@{profile.username}</span>
            ))}
          </div>
        )}
        <div className="post-actions">
          <button
            className={liked ? "is-liked" : ""}
            onClick={toggleLike}
            disabled={!post.reactions_enabled}
            aria-label={liked ? "Убрать лайк" : "Нравится"}
          >
            <Heart
              size={21}
              strokeWidth={1.8}
              fill={liked ? "currentColor" : "none"}
            />
            <span>{likes ?? ""}</span>
          </button>
          <button
            onClick={() => setShowComments(!showComments)}
            disabled={!post.comments_enabled}
            aria-label="Комментарии"
          >
            <MessageCircle size={21} strokeWidth={1.8} />
            <span>{post.comments_count}</span>
          </button>
          <button onClick={share} aria-label="Поделиться">
            <Share2 size={20} strokeWidth={1.8} />
          </button>
          <button
            className={`bookmark-action ${bookmarked ? "is-bookmarked" : ""}`}
            onClick={toggleBookmark}
            aria-label={bookmarked ? "Убрать из избранного" : "Сохранить"}
          >
            <Bookmark
              size={20}
              strokeWidth={1.8}
              fill={bookmarked ? "currentColor" : "none"}
            />
          </button>
        </div>
        {showComments && post.comments_enabled && (
          <Comments postId={post.id} user={user} />
        )}
        {toast && (
          <button className="inline-toast" onClick={() => setToast("")}>
            {toast} ×
          </button>
        )}
      </div>
    </article>
  );
}
