import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post, User } from "../lib/types";
import { PostCard } from "./PostCard";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  api: mocks,
  errorMessage: () => "Ошибка сети",
}));

const post: Post = {
  id: "post-1",
  author: {
    id: "profile-1",
    display_name: "Алия",
    username: "aliya",
    avatar_url: null,
    age: null,
    instagram_url: null,
    tiktok_url: null,
    bio: "",
    is_active: true,
  },
  coauthor: null,
  title: "Первый день",
  content: "Наша история",
  event_date: "2026-02-14",
  event_time: null,
  location: null,
  visibility: "private",
  status: "published",
  comments_enabled: true,
  comment_access: "members",
  moderate_comments: false,
  reactions_enabled: true,
  hide_like_count: false,
  quote_enabled: true,
  show_in_timeline: true,
  is_pinned: false,
  scheduled_at: null,
  published_at: "2026-02-14T12:00:00Z",
  created_at: "2026-02-14T12:00:00Z",
  deleted_at: null,
  media: [],
  categories: [],
  tags: [],
  mention_profile_ids: [],
  mentions: [],
  likes_count: 2,
  comments_count: 0,
  liked: false,
  bookmarked: false,
  allowed_comment_user_ids: [],
};

const user: User = {
  id: "user-1",
  email: "aliya@example.com",
  display_name: "Алия",
  role: "member",
  access_granted: true,
};

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PostCard post={post} user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.post.mockReset();
  mocks.delete.mockReset();
});

describe("PostCard", () => {
  it("shows a like immediately and rolls it back when the request fails", async () => {
    let rejectRequest!: (reason: Error) => void;
    mocks.post.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "Нравится" }));
    expect(
      screen.getByRole("button", { name: "Убрать лайк" }).textContent,
    ).toContain("3");
    expect(mocks.post).toHaveBeenCalledWith("/posts/post-1/like");

    rejectRequest(new Error("offline"));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Нравится" }).textContent,
      ).toContain("2");
    });
    expect(screen.getByText(/Ошибка сети/)).toBeTruthy();
  });

  it("keeps a saved post marked after a successful request", async () => {
    mocks.post.mockResolvedValue({});
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith("/posts/post-1/bookmark"),
    );
    expect(
      screen.getByRole("button", { name: "Убрать из избранного" }),
    ).toBeTruthy();
  });
});
