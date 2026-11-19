import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag, Trash2 } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { Category } from "../lib/types";

export function CategoryAdmin() {
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories").then((r) => r.data),
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [message, setMessage] = useState("");
  function begin(category?: Category) {
    setEditing(category?.id || "new");
    setName(category?.name || "");
    setSlug(category?.slug || "");
    setMessage("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      if (editing === "new")
        await api.post("/admin/categories", { name, slug });
      else await api.patch(`/admin/categories/${editing}`, { name, slug });
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  async function remove(category: Category) {
    if (!window.confirm(`Удалить категорию «${category.name}»?`)) return;
    try {
      await api.delete(`/admin/categories/${category.id}`);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  return (
    <div className="admin-content">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Темы истории</p>
          <h2>Категории</h2>
        </div>
        <button className="button primary" onClick={() => begin()}>
          <Plus size={17} /> Добавить
        </button>
      </div>
      {message && <div className="form-error">{message}</div>}
      <div className="category-list">
        {categories.data?.map((category) => (
          <div className="category-row" key={category.id}>
            <span className="category-icon">
              <Tag size={19} />
            </span>
            <span>
              <strong>{category.name}</strong>
              <small>/{category.slug}</small>
            </span>
            <button
              className="button outline small"
              onClick={() => begin(category)}
            >
              Изменить
            </button>
            <button
              className="icon-button danger-text"
              aria-label={`Удалить ${category.name}`}
              onClick={() => remove(category)}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
        {categories.data?.length === 0 && (
          <div className="empty-state">Категорий пока нет.</div>
        )}
      </div>
      {editing && (
        <div className="modal-backdrop">
          <form className="modal-card form-stack" onSubmit={save}>
            <div className="modal-head">
              <h2>
                {editing === "new" ? "Новая категория" : "Изменить категорию"}
              </h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setEditing(null)}
              >
                ×
              </button>
            </div>
            <label>
              Название
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Адрес (латиница и дефисы)
              <input
                required
                pattern="[a-z0-9-]+"
                maxLength={100}
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
              />
            </label>
            {message && <div className="form-error">{message}</div>}
            <button className="button primary wide">Сохранить</button>
          </form>
        </div>
      )}
    </div>
  );
}
