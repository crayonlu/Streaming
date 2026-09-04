import { beforeEach, describe, expect, it } from "vitest";
import type { FollowRecord } from "@/shared/types/domain";
import { useFollowStore } from "./useFollowStore";

const follow: FollowRecord = {
  id: "bilibili-123",
  platform: "bilibili",
  roomId: "123",
  title: "测试直播",
  streamerName: "测试主播",
  coverUrl: "",
  followedAt: "2026-09-04T00:00:00.000Z",
};

describe("useFollowStore", () => {
  beforeEach(() => {
    useFollowStore.setState({
      follows: [],
      liveStatusMap: {},
      isLoading: false,
      isRefreshingStatus: false,
      error: false,
      sortByLive: true,
    });
  });

  it("updates the in-memory list after a follow mutation changes persisted records", () => {
    useFollowStore.getState().replaceFollows([follow]);

    expect(useFollowStore.getState().follows).toEqual([follow]);
  });
});
