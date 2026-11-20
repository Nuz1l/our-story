import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  CalendarDays,
  Heart,
  History,
  Images,
  LockKeyhole,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sparkles,
  Sun,
  UserRound,
  X,
} from "lucide-react";
import { api } from "./lib/api";
import type { SiteInfo, User } from "./lib/types";
import { FeedPage, PostPage } from "./pages/FeedPage";
import { GalleryPage } from "./pages/GalleryPage";
import { CalendarPage } from "./pages/CalendarPage";
import { SavedPage } from "./pages/SavedPage";

const AdminPage = lazy(() =>
  import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage })),
);
const LoginPage = lazy(() =>
  import("./pages/AuthPages").then((module) => ({ default: module.LoginPage })),
);
const InvitePage = lazy(() =>
  import("./pages/AuthPages").then((module) => ({
    default: module.InvitePage,
  })),
);
const RegisterPage = lazy(() =>
  import("./pages/AuthPages").then((module) => ({
    default: module.RegisterPage,
  })),
);

const fallbackSite: SiteInfo = {
  site_title: "Our Memories",
  site_description: "История, которую мы пишем вместе",
  relationship_start: null,
  primary_name: "Нурасыл",
  secondary_name: "Аяжан",
  site_public: false,
  theme: "light",
  hero_text: "Каждый момент — часть нашей истории.",
  registration_enabled: false,
  logo_media_id: null,
  favicon_media_id: null,
  background_media_id: null,
};

export function App() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const siteQuery = useQuery({
    queryKey: ["site"],
    queryFn: () => api.get<SiteInfo>("/site").then((r) => r.data),
    retry: 1,
    refetchInterval: (query) => (query.state.status === "error" ? 3000 : false),
  });
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<User>("/auth/me").then((r) => r.data),
    retry: false,
  });
  const site = siteQuery.data ?? fallbackSite;
  const user = meQuery.data;
  const savedTheme = useRef(localStorage.getItem("our-memories-theme"));
  const [theme, setTheme] = useState(() => savedTheme.current || "");
  useEffect(() => {
    if (!savedTheme.current) setTheme(site.theme);
  }, [site.theme]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme || "light";
    if (theme) localStorage.setItem("our-memories-theme", theme);
  }, [theme]);
  useEffect(() => {
    document.title = `${site.site_title} — наша история`;
  }, [site.site_title]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--hero-photo",
      site.background_media_id
        ? `url(/api/media/${site.background_media_id})`
        : "none",
    );
    if (!site.favicon_media_id) return;
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.href = `/api/media/${site.favicon_media_id}`;
  }, [site.background_media_id, site.favicon_media_id]);

  async function logout() {
    try {
      await api.post("/auth/logout");
    } finally {
      queryClient.setQueryData(["me"], null);
      queryClient.invalidateQueries();
      navigate("/login");
    }
  }

  if (siteQuery.isLoading || meQuery.isLoading)
    return (
      <div className="loading-screen">
        <span className="brand-mark">♥</span>
        <p>Открываем нашу историю…</p>
      </div>
    );
  if (siteQuery.isError)
    return (
      <div className="loading-screen">
        <LockKeyhole size={28} />
        <h1>Сервер недоступен</h1>
        <p>
          Проверяем соединение каждые несколько секунд. Если сервер только
          запускается, подождите.
        </p>
        <button className="button primary" onClick={() => siteQuery.refetch()}>
          Проверить сейчас
        </button>
      </div>
    );

  if (!user && !site.site_public) {
    return (
      <Suspense
        fallback={<div className="loading-screen">Открываем вход…</div>}
      >
        <Routes>
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/register" element={<RegisterPage site={site} />} />
          <Route path="/login" element={<LoginPage site={site} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  if (user && !user.access_granted && !site.site_public)
    return (
      <div className="loading-screen">
        <LockKeyhole size={32} />
        <h1>Доступ по приглашению</h1>
        <p>
          Аккаунт создан. Попросите администратора выдать доступ к личной
          истории.
        </p>
        <button className="button outline" onClick={logout}>
          Выйти
        </button>
      </div>
    );

  const navItems = [
    { to: "/", label: "Лента", icon: Heart },
    { to: "/story", label: "Наша история", icon: History },
    { to: "/gallery", label: "Галерея", icon: Images },
    { to: "/calendar", label: "Календарь", icon: CalendarDays },
  ];
  if (user) navItems.push({ to: "/saved", label: "Избранное", icon: Sparkles });
  if (user) navItems.push({ to: "/profile", label: "Мой профиль", icon: UserRound });
  if (user?.access_granted && ["admin", "super_admin"].includes(user.role))
    navItems.push({ to: "/admin", label: "Управление", icon: Settings });

  const navigation = (
    <nav className="main-nav" aria-label="Основная навигация">
      {navItems.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
        >
          <Icon size={20} strokeWidth={1.8} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <Link to="/" className="brand" onClick={() => setMobileOpen(false)}>
            <span className="brand-mark">
              {site.logo_media_id ? (
                <img src={`/api/media/${site.logo_media_id}`} alt="" />
              ) : (
                "♥"
              )}
            </span>
            <span>{site.site_title}</span>
          </Link>
          <button
            className="icon-button close-sidebar"
            aria-label="Закрыть меню"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <p className="sidebar-caption">Место для самого дорогого</p>
        {navigation}
        <div className="sidebar-bottom">
          <p className="eyebrow">Оформление</p>
          <div
            className="theme-switch"
            role="group"
            aria-label="Тема оформления"
          >
            <button
              title="Светлая"
              aria-label="Светлая тема"
              className={theme === "light" ? "selected" : ""}
              onClick={() => setTheme("light")}
            >
              <Sun size={18} />
            </button>
            <button
              title="Тёмная"
              aria-label="Тёмная тема"
              className={theme === "dark" ? "selected" : ""}
              onClick={() => setTheme("dark")}
            >
              <Moon size={18} />
            </button>
            <button
              title="Романтическая"
              aria-label="Романтическая тема"
              className={theme === "romantic" ? "selected" : ""}
              onClick={() => setTheme("romantic")}
            >
              <Heart size={18} />
            </button>
          </div>
          {user ? (
            <div className="user-chip">
              <span className="user-avatar">
                {user.display_name.charAt(0).toUpperCase()}
              </span>
              <span>
                <strong>{user.display_name}</strong>
                <small>
                  {user.role === "member" ? "Участник" : "Администратор"}
                </small>
              </span>
              <button
                className="icon-button"
                title="Выйти"
                aria-label="Выйти"
                onClick={logout}
              >
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <Link to="/login" className="button outline">
              <LogIn size={17} /> Войти
            </Link>
          )}
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="mobile-overlay"
          aria-label="Закрыть меню"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div className="page-frame">
        <header className="mobile-header">
          <button
            className="icon-button"
            aria-label="Открыть меню"
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
          </button>
          <Link to="/" className="brand">
            <span className="brand-mark">
              {site.logo_media_id ? (
                <img src={`/api/media/${site.logo_media_id}`} alt="" />
              ) : (
                "♥"
              )}
            </span>
            {site.site_title}
          </Link>
          <span />
        </header>
        <main>
          <Suspense
            fallback={<div className="empty-state">Загружаем страницу…</div>}
          >
            <Routes>
              <Route path="/" element={<FeedPage site={site} user={user} />} />
              <Route
                path="/story"
                element={<FeedPage site={site} user={user} story />}
              />
              <Route path="/posts/:id" element={<PostPage user={user} />} />
              <Route path="/gallery" element={<GalleryPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route
                path="/saved"
                element={
                  user ? <SavedPage user={user} /> : <Navigate to="/login" />
                }
              />
              <Route
                path="/profile"
                element={user ? <ProfilePage /> : <Navigate to="/login" />}
              />
              <Route
                path="/admin/*"
                element={
                  user?.access_granted &&
                  ["admin", "super_admin"].includes(user.role) ? (
                    <Suspense
                      fallback={
                        <div className="empty-state">
                          Загружаем панель управления…
                        </div>
                      }
                    >
                      <AdminPage user={user} />
                    </Suspense>
                  ) : (
                    <Navigate to="/" />
                  )
                }
              />
              <Route
                path="/login"
                element={user ? <Navigate to="/" /> : <LoginPage site={site} />}
              />
              <Route
                path="/register"
                element={
                  user ? <Navigate to="/" /> : <RegisterPage site={site} />
                }
              />
              <Route path="/invite" element={<InvitePage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </main>
        <footer className="site-footer">
          <span>{site.site_title} · Сделано с любовью</span>
          <span>Личная история, бережно сохранённая здесь</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="Мобильная навигация">
        {navItems.slice(0, 4).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <Icon size={22} strokeWidth={1.8} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
