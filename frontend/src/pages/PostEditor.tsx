import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ImagePlus,
  RotateCw,
  Save,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { api, errorMessage, uploadMedia } from "../lib/api";
import type { Category, Media, Post, Profile, User } from "../lib/types";

type MediaDraft = Pick<
  Media,
  "id" | "url" | "media_type" | "alt_text" | "sort_order" | "is_cover"
>;
type Draft = {
  author_profile_id: string;
  coauthor_profile_id: string;
  title: string;
  content: string;
  event_date: string;
  event_time: string;
  location: string;
  visibility: string;
  status: string;
  comments_enabled: boolean;
  comment_access: string;
  allowed_comment_user_ids: string[];
  moderate_comments: boolean;
  reactions_enabled: boolean;
  hide_like_count: boolean;
  quote_enabled: boolean;
  show_in_timeline: boolean;
  is_pinned: boolean;
  scheduled_at: string;
  published_at: string;
  category_ids: string[];
  mention_profile_ids: string[];
  tags: string;
  media: MediaDraft[];
};

const emptyDraft: Draft = {
  author_profile_id: "",
  coauthor_profile_id: "",
  title: "",
  content: "",
  event_date: "",
  event_time: "",
  location: "",
  visibility: "private",
  status: "draft",
  comments_enabled: true,
  comment_access: "members",
  allowed_comment_user_ids: [],
  moderate_comments: false,
  reactions_enabled: true,
  hide_like_count: false,
  quote_enabled: true,
  show_in_timeline: true,
  is_pinned: false,
  scheduled_at: "",
  published_at: "",
  category_ids: [],
  mention_profile_ids: [],
  tags: "",
  media: [],
};

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function transformImage(
  file: File,
  ratio: string,
  rotation: number,
): Promise<File> {
  if (ratio === "original" && rotation === 0) return file;
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (ratio !== "original") {
    const target = ratio === "1:1" ? 1 : ratio === "4:5" ? 4 / 5 : 16 / 9;
    if (width / height > target) width = Math.round(height * target);
    else height = Math.round(width / target);
  }
  const turn = rotation % 180 !== 0;
  const canvas = document.createElement("canvas");
  canvas.width = turn ? height : width;
  canvas.height = turn ? width : height;
  const context = canvas.getContext("2d")!;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(
    bitmap,
    (bitmap.width - width) / 2,
    (bitmap.height - height) / 2,
    width,
    height,
    -width / 2,
    -height / 2,
    width,
    height,
  );
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error("Не удалось обработать изображение")),
      "image/webp",
      0.9,
    ),
  );
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, {
    type: "image/webp",
  });
}

export function PostEditor() {
  const { id } = useParams();
  const edit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>(() => {
    if (id) return emptyDraft;
    try {
      return {
        ...emptyDraft,
        ...JSON.parse(localStorage.getItem("our-memories-draft-new") || "{}"),
      };
    } catch {
      return emptyDraft;
    }
  });
  const [dirty, setDirty] = useState(false);
  const [ratio, setRatio] = useState("original");
  const [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const profiles = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: () => api.get<Profile[]>("/admin/profiles").then((r) => r.data),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories").then((r) => r.data),
  });
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get<User[]>("/admin/users").then((r) => r.data),
  });
  const post = useQuery({
    queryKey: ["post", id],
    queryFn: () => api.get<Post>(`/posts/${id}`).then((r) => r.data),
    enabled: edit,
  });
  useEffect(() => {
    if (!post.data) return;
    const p = post.data;
    const fromServer: Draft = {
      author_profile_id: p.author.id,
      coauthor_profile_id: p.coauthor?.id || "",
      title: p.title || "",
      content: p.content,
      event_date: p.event_date || "",
      event_time: p.event_time?.slice(0, 5) || "",
      location: p.location || "",
      visibility: p.visibility,
      status: p.status,
      comments_enabled: p.comments_enabled,
      comment_access: p.comment_access,
      allowed_comment_user_ids: p.allowed_comment_user_ids,
      moderate_comments: p.moderate_comments,
      reactions_enabled: p.reactions_enabled,
      hide_like_count: p.hide_like_count,
      quote_enabled: p.quote_enabled,
      show_in_timeline: p.show_in_timeline,
      is_pinned: p.is_pinned,
      scheduled_at: localDateTime(p.scheduled_at),
      published_at: localDateTime(p.published_at),
      category_ids: p.categories.map((c) => c.id),
      mention_profile_ids: p.mention_profile_ids,
      tags: p.tags.join(", "),
      media: p.media,
    };
    try {
      setDraft({
        ...fromServer,
        ...JSON.parse(localStorage.getItem(`our-memories-draft-${id}`) || "{}"),
      });
    } catch {
      setDraft(fromServer);
    }
  }, [post.data]);
  useEffect(() => {
    if (edit && !post.data) return;
    const timer = window.setTimeout(
      () =>
        localStorage.setItem(
          `our-memories-draft-${id || "new"}`,
          JSON.stringify(draft),
        ),
      600,
    );
    return () => window.clearTimeout(timer);
  }, [draft, edit, id, post.data]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!edit && !draft.author_profile_id && profiles.data?.length)
      setDraft((d) => ({ ...d, author_profile_id: profiles.data![0].id }));
  }, [edit, profiles.data, draft.author_profile_id]);
  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDirty(true);
    setDraft((d) => ({ ...d, [key]: value }));
  }
  async function upload(files: FileList | File[]) {
    setUploading(true);
    setUploadProgress(0);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const prepared = file.type.startsWith("image/")
          ? await transformImage(file, ratio, rotation)
          : file;
        setUploadProgress(0);
        const uploaded = await uploadMedia(prepared, setUploadProgress);
        setDirty(true);
        setDraft((d) => ({
          ...d,
          media: [
            ...d.media,
            {
              id: uploaded.id,
              url: uploaded.url,
              media_type: uploaded.media_type,
              alt_text: "",
              sort_order: d.media.length,
              is_cover: d.media.length === 0,
            },
          ],
        }));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }
  function moveMedia(index: number, delta: number) {
    const next = [...draft.media];
    const other = index + delta;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    set("media", next);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!draft.author_profile_id) {
      setError("Создайте и выберите профиль автора.");
      return;
    }
    if (!draft.content.trim() && !draft.media.length) {
      setError("Добавьте текст или медиафайл.");
      return;
    }
    setBusy(true);
    const payload = {
      ...draft,
      coauthor_profile_id: draft.coauthor_profile_id || null,
      title: draft.title || null,
      event_date: draft.event_date || null,
      event_time: draft.event_time || null,
      location: draft.location || null,
      scheduled_at: draft.scheduled_at
        ? new Date(draft.scheduled_at).toISOString()
        : null,
      published_at: draft.published_at
        ? new Date(draft.published_at).toISOString()
        : null,
      tags: draft.tags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      media: draft.media.map((m, index) => ({
        media_id: m.id,
        alt_text: m.alt_text,
        sort_order: index,
        is_cover: m.is_cover,
      })),
    };
    try {
      if (edit) await api.patch(`/posts/${id}`, payload);
      else await api.post("/posts", payload);
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
      localStorage.removeItem(`our-memories-draft-${id || "new"}`);
      setDirty(false);
      navigate("/admin/posts");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  function confirmLeave(event: React.MouseEvent<HTMLAnchorElement>) {
    if (
      dirty &&
      !window.confirm("Есть несохранённые изменения. Уйти со страницы?")
    )
      event.preventDefault();
  }
  if (edit && post.isLoading)
    return <div className="empty-state">Загружаем публикацию…</div>;
  return (
    <div className="editor-page">
      <Link to="/admin/posts" className="back-link" onClick={confirmLeave}>
        <ArrowLeft size={17} /> К публикациям
      </Link>
      <div className="admin-title">
        <div>
          <p className="eyebrow">Редактор воспоминаний</p>
          <h1>{edit ? "Изменить публикацию" : "Новая публикация"}</h1>
          <p className="muted tiny">
            Черновик автоматически сохраняется в этом браузере.
          </p>
        </div>
      </div>
      <form onSubmit={save} className="editor-layout">
        <div className="editor-main">
          <section className="panel">
            <h2>Основное</h2>
            <div className="form-grid">
              <label>
                Автор
                <select
                  value={draft.author_profile_id}
                  onChange={(e) => set("author_profile_id", e.target.value)}
                  required
                >
                  <option value="">Выберите автора</option>
                  {profiles.data
                    ?.filter((p) => p.is_active)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name} · @{p.username}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Соавтор
                <select
                  value={draft.coauthor_profile_id}
                  onChange={(e) => set("coauthor_profile_id", e.target.value)}
                >
                  <option value="">Без соавтора</option>
                  {profiles.data
                    ?.filter(
                      (p) => p.id !== draft.author_profile_id && p.is_active,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              Заголовок
              <input
                value={draft.title}
                maxLength={200}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Как назвать этот момент?"
              />
            </label>
            <label>
              Текст воспоминания
              <textarea
                rows={8}
                value={draft.content}
                onChange={(e) => set("content", e.target.value)}
                placeholder="Расскажите историю этого дня…"
              />
            </label>
            <div className="form-grid">
              <label>
                Дата события
                <input
                  type="date"
                  value={draft.event_date}
                  onChange={(e) => set("event_date", e.target.value)}
                />
              </label>
              <label>
                Время события
                <input
                  type="time"
                  value={draft.event_time}
                  onChange={(e) => set("event_time", e.target.value)}
                />
              </label>
              <label>
                Место
                <input
                  value={draft.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="Например, любимое кафе"
                />
              </label>
            </div>
            <label>
              Теги через запятую
              <input
                value={draft.tags}
                onChange={(e) => set("tags", e.target.value)}
                placeholder="лето, поездка, годовщина"
              />
            </label>
            <div className="field-group">
              <span className="label-text">Категории</span>
              <div className="check-chip-row">
                {categories.data?.map((c) => (
                  <label key={c.id} className="check-chip">
                    <input
                      type="checkbox"
                      checked={draft.category_ids.includes(c.id)}
                      onChange={(e) =>
                        set(
                          "category_ids",
                          e.target.checked
                            ? [...draft.category_ids, c.id]
                            : draft.category_ids.filter((x) => x !== c.id),
                        )
                      }
                    />
                    {c.name}
                  </label>
                ))}
                {categories.data?.length === 0 && (
                  <small className="muted">
                    Категории можно создать в админке.
                  </small>
                )}
              </div>
            </div>
            <div className="field-group">
              <span className="label-text">Отметить профили</span>
              <div className="check-chip-row">
                {profiles.data
                  ?.filter((p) => p.is_active)
                  .map((p) => (
                    <label className="check-chip" key={p.id}>
                      <input
                        type="checkbox"
                        checked={draft.mention_profile_ids.includes(p.id)}
                        onChange={(e) =>
                          set(
                            "mention_profile_ids",
                            e.target.checked
                              ? [...draft.mention_profile_ids, p.id]
                              : draft.mention_profile_ids.filter(
                                  (id) => id !== p.id,
                                ),
                          )
                        }
                      />
                      {p.display_name}
                    </label>
                  ))}
              </div>
            </div>
          </section>
          <section className="panel">
            <h2>Фото и видео</h2>
            <p className="muted tiny">
              JPG, PNG, WebP, MP4 и WebM до 30 МБ. Изображения можно обрезать по
              центру и повернуть перед загрузкой.
            </p>
            <div className="media-tools">
              <label>
                Формат
                <select
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                >
                  <option value="original">Исходный</option>
                  <option value="1:1">Квадрат 1:1</option>
                  <option value="4:5">Портрет 4:5</option>
                  <option value="16:9">Широкий 16:9</option>
                </select>
              </label>
              <button
                type="button"
                className="button outline small"
                onClick={() => setRotation((x) => (x + 90) % 360)}
              >
                <RotateCw size={16} /> Поворот {rotation}°
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) upload(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={`upload-zone ${dragging ? "dragging" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                upload(e.dataTransfer.files);
              }}
            >
              <UploadCloud size={27} />
              <strong>
                {uploading ? `Загружаем файл — ${uploadProgress}%` : "Перетащите файлы сюда"}
              </strong>
              <span>или нажмите для выбора</span>
            </button>
            <div className="media-drafts">
              {draft.media.map((m, i) => (
                <div className="media-draft" key={m.id}>
                  <div className="media-draft-thumb">
                    {m.media_type === "video" ? (
                      <video src={m.url} />
                    ) : (
                      <img src={m.url} alt="" />
                    )}
                  </div>
                  <div className="media-draft-fields">
                    <label>
                      Альтернативный текст
                      <input
                        value={m.alt_text}
                        maxLength={500}
                        onChange={(e) =>
                          set(
                            "media",
                            draft.media.map((x, n) =>
                              n === i ? { ...x, alt_text: e.target.value } : x,
                            ),
                          )
                        }
                        placeholder="Что изображено?"
                      />
                    </label>
                    <label className="checkbox-line">
                      <input
                        type="radio"
                        name="cover"
                        checked={m.is_cover}
                        onChange={() =>
                          set(
                            "media",
                            draft.media.map((x, n) => ({
                              ...x,
                              is_cover: n === i,
                            })),
                          )
                        }
                      />{" "}
                      Обложка
                    </label>
                  </div>
                  <div className="media-draft-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Поднять выше"
                      onClick={() => moveMedia(i, -1)}
                    >
                      <ArrowUp size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Опустить ниже"
                      onClick={() => moveMedia(i, 1)}
                    >
                      <ArrowDown size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label="Убрать файл"
                      onClick={() =>
                        set(
                          "media",
                          draft.media.filter((x) => x.id !== m.id),
                        )
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <div className="editor-side">
          <section className="panel">
            <h2>Публикация</h2>
            <label>
              Статус
              <select
                value={draft.status}
                onChange={(e) => set("status", e.target.value)}
              >
                <option value="draft">Черновик</option>
                <option value="published">Опубликовать</option>
                <option value="scheduled">Запланировать</option>
                <option value="archived">Архив</option>
              </select>
            </label>
            {draft.status === "scheduled" && (
              <label>
                Дата и время публикации
                <input
                  type="datetime-local"
                  value={draft.scheduled_at}
                  onChange={(e) => set("scheduled_at", e.target.value)}
                  required
                />
              </label>
            )}
            <label>
              Изменить дату публикации
              <input
                type="datetime-local"
                value={draft.published_at}
                onChange={(e) => set("published_at", e.target.value)}
              />
            </label>
            <label>
              Видимость
              <select
                value={draft.visibility}
                onChange={(e) => set("visibility", e.target.value)}
              >
                <option value="private">Приватная</option>
                <option value="invited">По приглашению</option>
                <option value="public">Публичная</option>
              </select>
            </label>
            <p className="muted tiny">
              Приватная запись доступна только администраторам; «по приглашению»
              — участникам. Публичные посты видны гостям после включения
              открытого доступа.
            </p>
          </section>
          <section className="panel">
            <h2>Настройки</h2>
            {(
              [
                ["comments_enabled", "Разрешить комментарии"],
                ["moderate_comments", "Проверять комментарии"],
                ["reactions_enabled", "Разрешить реакции"],
                ["hide_like_count", "Скрыть число лайков"],
                ["is_pinned", "Закрепить в ленте"],
                ["show_in_timeline", "Показывать в хронологии"],
                ["quote_enabled", "Разрешить цитирование"],
              ] as const
            ).map(([key, label]) => (
              <label className="toggle-line" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(e) => set(key, e.target.checked)}
                />
              </label>
            ))}
            {draft.comments_enabled && (
              <label>
                Кто может комментировать
                <select
                  value={draft.comment_access}
                  onChange={(e) => set("comment_access", e.target.value)}
                >
                  <option value="members">Все участники</option>
                  <option value="selected">Выбранные участники</option>
                </select>
              </label>
            )}
            {draft.comment_access === "selected" && (
              <div className="field-group">
                <span className="label-text">Участники</span>
                {users.data?.map((u) => (
                  <label key={u.id} className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={draft.allowed_comment_user_ids.includes(u.id)}
                      onChange={(e) =>
                        set(
                          "allowed_comment_user_ids",
                          e.target.checked
                            ? [...draft.allowed_comment_user_ids, u.id]
                            : draft.allowed_comment_user_ids.filter(
                                (id) => id !== u.id,
                              ),
                        )
                      }
                    />
                    {u.display_name}
                  </label>
                ))}
              </div>
            )}
          </section>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary wide" disabled={busy || uploading}>
            <Save size={18} /> {busy ? "Сохраняем…" : "Сохранить публикацию"}
          </button>
          <Link
            to="/admin/posts"
            className="button ghost wide"
            onClick={confirmLeave}
          >
            <ImagePlus size={17} /> Вернуться к списку
          </Link>
        </div>
      </form>
    </div>
  );
}
