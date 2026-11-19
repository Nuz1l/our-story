import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Images, X } from "lucide-react";
import { api } from "../lib/api";
import type { Profile } from "../lib/types";

type GalleryItem = {
  id: string;
  post_id: string;
  url: string;
  media_type: "image" | "video";
  alt_text: string;
  event_date: string | null;
  author: Profile;
};

export function GalleryPage() {
  const [author, setAuthor] = useState("");
  const [month, setMonth] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const gallery = useQuery({
    queryKey: ["gallery"],
    queryFn: () => api.get<GalleryItem[]>("/gallery").then((r) => r.data),
  });
  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: () => api.get<Profile[]>("/profiles").then((r) => r.data),
  });
  const items = (gallery.data || []).filter(
    (item) =>
      (!author || item.author.id === author) &&
      (!month || item.event_date?.startsWith(month)),
  );
  const current = selected === null ? null : items[selected];
  useEffect(() => {
    if (selected === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "ArrowLeft")
        setSelected((value) =>
          value === null ? null : (value - 1 + items.length) % items.length,
        );
      if (event.key === "ArrowRight")
        setSelected((value) =>
          value === null ? null : (value + 1) % items.length,
        );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, items.length]);
  function next(delta: number) {
    if (selected !== null)
      setSelected((selected + delta + items.length) % items.length);
  }
  return (
    <div className="standard-page">
      <div className="page-intro">
        <span className="page-icon">
          <Images size={22} />
        </span>
        <p className="eyebrow">Наши мгновения</p>
        <h1>Галерея</h1>
        <p>Фотографии и видео, к которым хочется возвращаться снова.</p>
      </div>
      <div className="gallery-toolbar">
        <select
          aria-label="Фильтр по автору"
          value={author}
          onChange={(e) => {
            setAuthor(e.target.value);
            setSelected(null);
          }}
        >
          <option value="">Все авторы</option>
          {profiles.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
        <input
          type="month"
          aria-label="Фильтр по месяцу"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setSelected(null);
          }}
        />
        {month && (
          <button className="button ghost small" onClick={() => setMonth("")}>
            Сбросить
          </button>
        )}
        <span className="gallery-count">{items.length} медиафайлов</span>
      </div>
      {gallery.isLoading && (
        <div className="empty-state">Загружаем галерею…</div>
      )}
      {!gallery.isLoading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">
            <Images />
          </div>
          <h3>Пока нет фотографий</h3>
          <p>Добавьте фото или видео к публикациям, и они появятся здесь.</p>
        </div>
      )}
      <div className="gallery-grid">
        {items.map((item, index) => (
          <button
            key={`${item.id}-${index}`}
            className="gallery-item"
            onClick={() => setSelected(index)}
            aria-label={`Открыть ${item.alt_text || "медиафайл"}`}
          >
            {item.media_type === "video" ? (
              <video src={item.url} muted preload="metadata" />
            ) : (
              <img
                src={item.url}
                alt={item.alt_text || "Воспоминание"}
                loading="lazy"
              />
            )}
            <span>
              {item.event_date
                ? new Intl.DateTimeFormat("ru-RU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }).format(new Date(item.event_date))
                : item.author.display_name}
            </span>
          </button>
        ))}
      </div>
      {current && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр медиа"
        >
          <button
            className="lightbox-close"
            aria-label="Закрыть"
            onClick={() => setSelected(null)}
          >
            <X />
          </button>
          <button
            className="lightbox-prev"
            aria-label="Предыдущий"
            onClick={() => next(-1)}
          >
            <ArrowLeft />
          </button>
          {current.media_type === "video" ? (
            <video src={current.url} controls autoPlay />
          ) : (
            <img src={current.url} alt={current.alt_text || "Воспоминание"} />
          )}
          <button
            className="lightbox-next"
            aria-label="Следующий"
            onClick={() => next(1)}
          >
            <ArrowRight />
          </button>
          <div className="lightbox-caption">
            <span>{current.alt_text || current.author.display_name}</span>
            <Link
              to={`/posts/${current.post_id}`}
              onClick={() => setSelected(null)}
            >
              К публикации →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
