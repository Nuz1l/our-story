import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteInfo } from "../lib/types";
import { LoginPage } from "./AuthPages";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../lib/api", () => ({
  api: mocks,
  errorMessage: () => "Ошибка входа",
}));

const site: SiteInfo = {
  site_title: "Our Memories",
  site_description: "Наша история",
  relationship_start: null,
  primary_name: "Алия",
  secondary_name: "Дамир",
  site_public: false,
  theme: "light",
  hero_text: "",
  registration_enabled: false,
  logo_media_id: null,
  favicon_media_id: null,
  background_media_id: null,
};

function renderLogin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage site={site} />} />
          <Route path="/" element={<p>Лента воспоминаний</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => mocks.post.mockReset());

describe("LoginPage", () => {
  it("validates email before sending credentials", async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText("Email"), "invalid");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret-password");
    await userEvent.click(
      screen.getByRole("button", { name: /Войти в историю/ }),
    );

    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("opens the feed after a successful login", async () => {
    mocks.post.mockResolvedValue({});
    renderLogin();
    await userEvent.type(screen.getByLabelText("Email"), "aliya@example.com");
    await userEvent.type(screen.getByLabelText("Пароль"), "secret-password");
    await userEvent.click(
      screen.getByRole("button", { name: /Войти в историю/ }),
    );

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith("/auth/login", {
        email: "aliya@example.com",
        password: "secret-password",
      });
      expect(screen.getByText("Лента воспоминаний")).toBeTruthy();
    });
  });
});
