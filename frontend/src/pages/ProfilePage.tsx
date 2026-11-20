import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ExternalLink, Instagram, Save, UserRound } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { Profile, User } from "../lib/types";

type OwnProfile = Omit<Profile, "id"> & { id: string | null };

function socialPreviewUrl(value: string, hosts: string[]): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.includes(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

async function prepareAvatar(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Выберите изображение JPG, PNG или WebP");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось обработать изображение");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
    if (!blob || blob.size > 3 * 1024 * 1024) throw new Error("Аватар слишком большой");
    return new File([blob], "avatar.jpg", { type: "image/jpeg" });
  } finally {
    image.close();
  }
}

function ProfileEditor({ initial }: { initial: OwnProfile }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial.display_name);
  const [age, setAge] = useState(initial.age?.toString() ?? "");
  const [bio, setBio] = useState(initial.bio);
  const [instagram, setInstagram] = useState(initial.instagram_url ?? "");
  const [tiktok, setTiktok] = useState(initial.tiktok_url ?? "");
  const [avatar, setAvatar] = useState(initial.avatar_url);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const instagramLink = socialPreviewUrl(instagram, ["instagram.com", "www.instagram.com"]);
  const tiktokLink = socialPreviewUrl(tiktok, ["tiktok.com", "www.tiktok.com"]);

  async function uploadAvatar(file: File) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const prepared = await prepareAvatar(file);
      const form = new FormData();
      form.append("file", prepared);
      const response = await api.post<OwnProfile>("/profile/avatar", form);
      setAvatar(response.data.avatar_url);
      queryClient.setQueryData(["my-profile"], response.data);
      queryClient.setQueryData<User | null>(["me"], (current) =>
        current ? { ...current, avatar_url: response.data.avatar_url } : current,
      );
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["post"] });
      queryClient.invalidateQueries({ queryKey: ["comments"] });
      setMessage("Аватар сохранён");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await api.patch<OwnProfile>("/profile/me", {
        display_name: name.trim(),
        age: age ? Number(age) : null,
        bio: bio.trim(),
        instagram_url: instagram.trim() || null,
        tiktok_url: tiktok.trim() || null,
      });
      queryClient.setQueryData(["my-profile"], response.data);
      queryClient.setQueryData<User | null>(["me"], (current) =>
        current ? { ...current, display_name: response.data.display_name } : current,
      );
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      setMessage("Профиль сохранён");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-page">
      <div className="page-heading">
        <p className="eyebrow">Личная страница</p>
        <h1>Мой профиль</h1>
        <p>Расскажите немного о себе и добавьте фото.</p>
      </div>
      <div className="profile-edit-layout">
        <section className="profile-preview" aria-label="Предпросмотр профиля">
          <div className="profile-preview-avatar">
            {avatar ? <img src={avatar} alt="Аватар профиля" /> : <UserRound size={60} />}
          </div>
          <h2>{name.trim() || "Ваше имя"}</h2>
          {age && <p>{age} лет</p>}
          {bio && <p>{bio}</p>}
          <div className="profile-social-links">
            {instagramLink && <a href={instagramLink} target="_blank" rel="noopener noreferrer"><Instagram size={17} /> Instagram <ExternalLink size={14} /></a>}
            {tiktokLink && <a href={tiktokLink} target="_blank" rel="noopener noreferrer">TikTok <ExternalLink size={14} /></a>}
          </div>
        </section>
        <form className="profile-edit-form form-stack" onSubmit={save}>
          <label className="profile-upload-button">
            <Camera size={19} /> {busy ? "Загружаем…" : "Выбрать аватар"}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAvatar(file);
                event.target.value = "";
              }} />
          </label>
          <label>Имя<input required minLength={1} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Возраст<input type="number" min={1} max={120} inputMode="numeric" value={age} onChange={(event) => setAge(event.target.value)} placeholder="Например, 25" /></label>
          <label>О себе<textarea maxLength={1000} rows={4} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="Несколько слов о себе" /></label>
          <label>Ссылка на Instagram<input type="url" value={instagram} onChange={(event) => setInstagram(event.target.value)} placeholder="https://www.instagram.com/username/" /></label>
          <label>Ссылка на TikTok<input type="url" value={tiktok} onChange={(event) => setTiktok(event.target.value)} placeholder="https://www.tiktok.com/@username" /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          {message && <div className="profile-save-message" role="status">{message}</div>}
          <button className="button primary" type="submit" disabled={busy}><Save size={17} /> Сохранить профиль</button>
        </form>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const profile = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => api.get<OwnProfile>("/profile/me").then((response) => response.data),
  });
  if (profile.isPending) return <div className="empty-state">Загружаем профиль…</div>;
  if (profile.isError) return <div className="empty-state">Не удалось загрузить профиль. <button className="button outline" onClick={() => profile.refetch()}>Повторить</button></div>;
  return <ProfileEditor initial={profile.data} />;
}
