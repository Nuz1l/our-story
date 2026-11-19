import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import type { Page, Post } from "../lib/types";
import { Link } from "react-router-dom";

const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function CalendarPage() {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [view, setView] = useState({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const dates = useQuery({
    queryKey: ["calendar", view.year, view.month],
    queryFn: () =>
      api
        .get<{ date: string; count: number }[]>("/calendar", { params: view })
        .then((r) => r.data),
  });
  const posts = useQuery({
    queryKey: ["calendar-posts", selected],
    queryFn: () =>
      api
        .get<Page<Post>>("/posts", { params: { event_date: selected } })
        .then((r) => r.data),
    enabled: !!selected,
  });
  const countMap = new Map(dates.data?.map((d) => [d.date, d.count]));
  const first = new Date(view.year, view.month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(view.year, view.month, 0).getDate();
  const monthLabel = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(first);
  function changeMonth(delta: number) {
    const date = new Date(view.year, view.month - 1 + delta, 1);
    setView({ year: date.getFullYear(), month: date.getMonth() + 1 });
    setSelected(null);
  }
  return (
    <div className="standard-page">
      <div className="page-intro">
        <span className="page-icon">
          <CalendarDays size={22} />
        </span>
        <p className="eyebrow">Особенные даты</p>
        <h1>Календарь воспоминаний</h1>
        <p>Иногда одна дата хранит целую историю.</p>
      </div>
      <div className="calendar-card">
        <div className="calendar-head">
          <h2>{monthLabel}</h2>
          <div>
            <button
              className="icon-button"
              aria-label="Предыдущий месяц"
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft />
            </button>
            <button
              className="icon-button"
              aria-label="Следующий месяц"
              onClick={() => changeMonth(1)}
            >
              <ChevronRight />
            </button>
          </div>
        </div>
        <div className="calendar-grid">
          {weekdays.map((day) => (
            <span className="weekday" key={day}>
              {day}
            </span>
          ))}
          {Array.from({ length: offset }).map((_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const key = `${view.year}-${String(view.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const count = countMap.get(key);
            return (
              <button
                key={key}
                className={`calendar-day ${count ? "has-memory" : ""} ${selected === key ? "selected" : ""} ${key === todayKey ? "today" : ""}`}
                onClick={() => setSelected(key)}
              >
                <span>{day}</span>
                {count && <i title={`${count} воспоминаний`} />}
              </button>
            );
          })}
        </div>
      </div>
      {selected && (
        <div className="calendar-results">
          <h2>
            {new Intl.DateTimeFormat("ru-RU", {
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(new Date(selected))}
          </h2>
          {posts.isLoading && <p className="muted">Ищем воспоминания…</p>}
          {posts.data?.items.length === 0 && (
            <p className="muted">На эту дату воспоминаний пока нет.</p>
          )}
          {posts.data?.items.map((post) => (
            <Link
              key={post.id}
              className="calendar-post"
              to={`/posts/${post.id}`}
            >
              <span className="calendar-post-heart">♥</span>
              <span>
                <strong>{post.title || "Наш момент"}</strong>
                <small>{post.author.display_name}</small>
              </span>
              <span>→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
