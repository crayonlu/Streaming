import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFeatured, getRoomsByCategory } from "@/shared/api/commands";
import type { PlatformId, RoomCard } from "@/shared/types/domain";
import { useDiscoverStore } from "./useDiscoverStore";

vi.mock("@/shared/api/commands", () => ({
  getFeatured: vi.fn(),
  getRoomsByCategory: vi.fn(),
}));

const mockedGetFeatured = vi.mocked(getFeatured);
const mockedGetRoomsByCategory = vi.mocked(getRoomsByCategory);

function room(platform: PlatformId, id: string): RoomCard {
  return {
    id,
    platform,
    roomId: id,
    title: `${platform}-${id}`,
    streamerName: id,
    coverUrl: "",
    isLive: true,
    followed: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const initialState = {
  rooms: [],
  isLoading: false,
  error: null,
  page: 0,
  hasNextPage: true,
  platform: null,
  categorySelection: null,
  requestEpoch: 0,
};

describe("useDiscoverStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDiscoverStore.setState(initialState);
  });

  it("keeps the latest platform data when an older request resolves later", async () => {
    const bilibili = deferred<RoomCard[]>();
    const douyu = deferred<RoomCard[]>();
    mockedGetFeatured.mockReturnValueOnce(bilibili.promise).mockReturnValueOnce(douyu.promise);

    const first = useDiscoverStore.getState().fetchFirstPage("bilibili");
    const second = useDiscoverStore.getState().fetchFirstPage("douyu");

    douyu.resolve([room("douyu", "new")]);
    await second;
    bilibili.resolve([room("bilibili", "old")]);
    await first;

    const state = useDiscoverStore.getState();
    expect(state.platform).toBe("douyu");
    expect(state.rooms.map((item) => item.id)).toEqual(["new"]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("does not append a stale next page after switching platforms", async () => {
    const firstBilibili = deferred<RoomCard[]>();
    const nextBilibili = deferred<RoomCard[]>();
    const firstDouyu = deferred<RoomCard[]>();
    mockedGetFeatured
      .mockReturnValueOnce(firstBilibili.promise)
      .mockReturnValueOnce(nextBilibili.promise)
      .mockReturnValueOnce(firstDouyu.promise);

    const first = useDiscoverStore.getState().fetchFirstPage("bilibili");
    firstBilibili.resolve([room("bilibili", "first")]);
    await first;

    const next = useDiscoverStore.getState().fetchNextPage("bilibili");
    const switched = useDiscoverStore.getState().fetchFirstPage("douyu");
    firstDouyu.resolve([room("douyu", "current")]);
    await switched;
    nextBilibili.resolve([room("bilibili", "stale-next")]);
    await next;

    const state = useDiscoverStore.getState();
    expect(state.platform).toBe("douyu");
    expect(state.rooms.map((item) => item.id)).toEqual(["current"]);
  });

  it("drops an older category request when a newer load starts", async () => {
    const category = deferred<RoomCard[]>();
    const featured = deferred<RoomCard[]>();
    mockedGetRoomsByCategory.mockReturnValueOnce(category.promise);
    mockedGetFeatured.mockReturnValueOnce(featured.promise);

    useDiscoverStore.setState({ platform: "bilibili" });
    const categoryLoad = useDiscoverStore.getState().setCategorySelection({
      categoryId: "game",
      parentId: null,
      shortName: null,
    });
    const platformLoad = useDiscoverStore.getState().fetchFirstPage("douyu");

    featured.resolve([room("douyu", "current")]);
    await platformLoad;
    category.resolve([room("bilibili", "stale-category")]);
    await categoryLoad;

    const state = useDiscoverStore.getState();
    expect(state.platform).toBe("douyu");
    expect(state.categorySelection).toBeNull();
    expect(state.rooms.map((item) => item.id)).toEqual(["current"]);
  });
});
