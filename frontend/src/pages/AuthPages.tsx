import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Heart,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { SiteInfo } from "../lib/types";

const loginSchema = z.object({
  email: z.email("Укажите корректный email"),
  password: z.string().min(1, "Введите пароль"),
});
type LoginFields = z.infer<typeof loginSchema>;

export function LoginPage({ site }: { site: SiteInfo }) {
  const reducedMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFields>({ resolver: zodResolver(loginSchema) });
  async function onSubmit(values: LoginFields) {
    setError("");
    try {
      await api.post("/auth/login", values);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="auth-orbit orbit-one" />
        <div className="auth-orbit orbit-two" />
        <motion.div
          className="auth-art-inner"
          initial={reducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <div className="auth-heart">
            <Heart size={68} strokeWidth={1} fill="currentColor" />
          </div>
          <p className="eyebrow">Наша маленькая вселенная</p>
          <h1>
            Моменты, которые
            <br />
            <em>остаются с нами.</em>
          </h1>
          <p>{site.site_description}</p>
        </motion.div>
        <span className="art-footer">
          Our Memories · личный цифровой дневник
        </span>
      </div>
      <div className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-lock">
            <LockKeyhole size={22} />
          </div>
          <p className="eyebrow">Только для своих</p>
          <h2>
            Добро пожаловать
            <br />в нашу историю
          </h2>
          <p className="muted">
            Войдите, чтобы увидеть сохранённые воспоминания.
          </p>
          <form onSubmit={handleSubmit(onSubmit)} className="form-stack">
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                {...register("email")}
              />
            </label>
            {errors.email && (
              <small className="field-error">{errors.email.message}</small>
            )}
            <label>
              Пароль
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Ваш пароль"
                {...register("password")}
              />
            </label>
            {errors.password && (
              <small className="field-error">{errors.password.message}</small>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary wide" disabled={isSubmitting}>
              {isSubmitting ? "Входим…" : "Войти в историю"}{" "}
              <ArrowRight size={18} />
            </button>
          </form>
          {site.registration_enabled && (
            <p className="auth-register">
              Нет аккаунта?{" "}
              <Link to="/register" className="text-link">
                Зарегистрироваться
              </Link>
            </p>
          )}
          <div className="auth-help">
            <ShieldCheck size={17} />
            <span>
              Воспоминания скрыты от посторонних. Для доступа попросите
              приглашение у администратора.
            </span>
          </div>
          {site.site_public && (
            <Link to="/" className="text-link">
              Вернуться к открытой истории
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const inviteSchema = z.object({
  display_name: z.string().min(1, "Укажите имя"),
  password: z.string().min(12, "Минимум 12 символов"),
});
type InviteFields = z.infer<typeof inviteSchema>;

export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteFields>({ resolver: zodResolver(inviteSchema) });
  async function onSubmit(values: InviteFields) {
    setError("");
    try {
      await api.post("/auth/accept-invitation", { token, ...values });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <div className="simple-auth">
      <Link className="brand" to="/">
        <span className="brand-mark">♥</span> Our Memories
      </Link>
      <div className="auth-card">
        <div className="auth-lock">
          <Mail size={22} />
        </div>
        <p className="eyebrow">Добро пожаловать</p>
        <h1>Присоединиться к истории</h1>
        <p className="muted">
          Придумайте имя и надёжный пароль для личного доступа.
        </p>
        {!token ? (
          <div className="form-error">
            В ссылке отсутствует код приглашения.
          </div>
        ) : (
          <form className="form-stack" onSubmit={handleSubmit(onSubmit)}>
            <label>
              Ваше имя
              <input autoComplete="name" {...register("display_name")} />
            </label>
            {errors.display_name && (
              <small className="field-error">
                {errors.display_name.message}
              </small>
            )}
            <label>
              Пароль
              <input
                type="password"
                autoComplete="new-password"
                {...register("password")}
              />
            </label>
            {errors.password && (
              <small className="field-error">{errors.password.message}</small>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary wide" disabled={isSubmitting}>
              Создать доступ <ArrowRight size={18} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const registerSchema = z.object({
  email: z.email("Укажите корректный email"),
  display_name: z.string().min(1, "Укажите имя"),
  password: z.string().min(12, "Минимум 12 символов"),
});
type RegisterFields = z.infer<typeof registerSchema>;

export function RegisterPage({ site }: { site: SiteInfo }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFields>({ resolver: zodResolver(registerSchema) });
  if (!site.registration_enabled)
    return (
      <div className="simple-auth">
        <Link to="/login" className="brand">
          <span className="brand-mark">♥</span> Our Memories
        </Link>
        <div className="auth-card">
          <h1>Регистрация закрыта</h1>
          <p className="muted">Получите приглашение от администратора.</p>
          <Link className="button outline" to="/login">
            К входу
          </Link>
        </div>
      </div>
    );
  async function onSubmit(values: RegisterFields) {
    setError("");
    try {
      await api.post("/auth/register", values);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <div className="simple-auth">
      <Link to="/" className="brand">
        <span className="brand-mark">♥</span> Our Memories
      </Link>
      <div className="auth-card">
        <div className="auth-lock">
          <LockKeyhole size={22} />
        </div>
        <p className="eyebrow">Новый участник</p>
        <h1>Создать аккаунт</h1>
        <p className="muted">
          Для просмотра личных воспоминаний понадобится приглашение
          администратора.
        </p>
        <form className="form-stack" onSubmit={handleSubmit(onSubmit)}>
          <label>
            Email
            <input type="email" autoComplete="email" {...register("email")} />
          </label>
          {errors.email && (
            <small className="field-error">{errors.email.message}</small>
          )}
          <label>
            Имя
            <input autoComplete="name" {...register("display_name")} />
          </label>
          {errors.display_name && (
            <small className="field-error">{errors.display_name.message}</small>
          )}
          <label>
            Пароль
            <input
              type="password"
              autoComplete="new-password"
              {...register("password")}
            />
          </label>
          {errors.password && (
            <small className="field-error">{errors.password.message}</small>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary wide" disabled={isSubmitting}>
            Зарегистрироваться
          </button>
        </form>
      </div>
    </div>
  );
}
