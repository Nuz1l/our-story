import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

export const api = axios.create({ baseURL: "/api", withCredentials: true });

export async function uploadMedia(file: File, onProgress?: (percent: number) => void): Promise<{
  id: string;
  url: string;
  media_type: "image" | "video";
}> {
  if (file.size <= 3 * 1024 * 1024) {
    const form = new FormData();
    form.append("file", file);
    const result = (await api.post("/admin/media", form)).data;
    onProgress?.(100);
    return result;
  }
  if (file.size > 500 * 1024 * 1024) {
    throw new Error("Файл должен быть не больше 500 МБ");
  }
  const uploadId = crypto.randomUUID();
  const chunkSize = 2 * 1024 * 1024;
  const total = Math.ceil(file.size / chunkSize);
  let completed = 0;
  try {
    for (let start = 0; start < total; start += 4) {
      const batch = Array.from({ length: Math.min(4, total - start) }, (_, offset) => {
        const index = start + offset;
        const form = new FormData();
        form.append("upload_id", uploadId);
        form.append("index", String(index));
        form.append("file", file.slice(index * chunkSize, (index + 1) * chunkSize));
        return api.post("/admin/media/chunk", form).then(() => {
          completed++;
          onProgress?.(Math.round((completed / total) * 90));
        });
      });
      const results = await Promise.allSettled(batch);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    const result = (
      await api.post("/admin/media/complete", {
        upload_id: uploadId,
        total,
        filename: file.name,
      })
    ).data;
    onProgress?.(100);
    return result;
  } catch (error) {
    try {
      await api.post("/admin/media/cancel", {
        upload_id: uploadId,
        total,
        filename: file.name,
      });
    } catch {
      // The original upload error is more useful to the user.
    }
    throw error;
  }
}

function cookie(name: string) {
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

api.interceptors.request.use((config) => {
  if (
    config.method &&
    !["get", "head", "options"].includes(config.method.toLowerCase())
  ) {
    const csrf = cookie("csrf_token");
    if (csrf) config.headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  }
  return config;
});

let refreshPromise: Promise<unknown> | null = null;
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as
      (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !original.url?.includes("/auth/refresh") &&
      !original.url?.includes("/auth/login")
    ) {
      original._retry = true;
      refreshPromise ??= api.post("/auth/refresh").finally(() => {
        refreshPromise = null;
      });
      try {
        await refreshPromise;
        return api(original);
      } catch {
        /* Session expired. */
      }
    }
    return Promise.reject(error);
  },
);

export function errorMessage(error: unknown): string {
  if (error instanceof Error && !axios.isAxiosError(error)) return error.message;
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((item) => item.msg).join(", ");
  }
  return "Не удалось выполнить действие. Попробуйте ещё раз.";
}
