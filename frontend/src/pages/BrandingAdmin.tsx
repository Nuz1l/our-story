import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, UploadCloud } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { SiteInfo } from "../lib/types";

const assets = [
  {
    key: "logo_media_id",
    label: "Логотип",
    hint: "Квадратное изображение для названия сайта.",
  },
  {
    key: "favicon_media_id",
    label: "Favicon",
    hint: "Небольшая иконка вкладки браузера.",
  },
  {
    key: "background_media_id",
    label: "Фон главной",
    hint: "Фотография для верхнего блока ленты.",
  },
] as const;

export function BrandingAdmin() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.get<SiteInfo>("/admin/settings").then((r) => r.data),
  });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  async function upload(key: (typeof assets)[number]["key"], file: File) {
    setBusy(key);
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      const uploaded = await api.post<{ id: string }>("/admin/media", form);
      await api.patch("/admin/settings", { [key]: uploaded.data.id });
      await queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      queryClient.invalidateQueries({ queryKey: ["site"] });
      setMessage("Изображение обновлено");
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy("");
    }
  }
  async function clear(key: (typeof assets)[number]["key"]) {
    try {
      await api.patch("/admin/settings", { [key]: null });
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      queryClient.invalidateQueries({ queryKey: ["site"] });
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }
  return (
    <div className="admin-content">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Фотографии и стиль</p>
          <h2>Оформление</h2>
        </div>
      </div>
      {message && (
        <div
          className={
            message === "Изображение обновлено" ? "success-box" : "form-error"
          }
        >
          {message}
        </div>
      )}
      <div className="branding-grid">
        {assets.map((asset) => {
          const id = settings.data?.[asset.key];
          return (
            <div className="panel branding-card" key={asset.key}>
              <div className="branding-preview">
                {id ? (
                  <img src={`/api/media/${id}`} alt={asset.label} />
                ) : (
                  <ImagePlus size={30} />
                )}
              </div>
              <h3>{asset.label}</h3>
              <p className="muted tiny">{asset.hint}</p>
              <label className="button outline">
                <UploadCloud size={16} />{" "}
                {busy === asset.key ? "Загрузка…" : "Загрузить изображение"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  disabled={!!busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload(asset.key, file);
                    e.target.value = "";
                  }}
                />
              </label>
              {id && (
                <button
                  className="button ghost small"
                  onClick={() => clear(asset.key)}
                >
                  Убрать изображение
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
