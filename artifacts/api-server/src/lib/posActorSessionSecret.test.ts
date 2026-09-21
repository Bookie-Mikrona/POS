import { describe, expect, it } from "vitest";
import { getPosActorSessionSecret } from "./posActorSessionSecret";

describe("getPosActorSessionSecret", () => {
  it("da prednost namenski actor skrivnosti", () => {
    expect(getPosActorSessionSecret({
      POS_ACTOR_SESSION_SECRET: "actor-secret",
      SESSION_SECRET: "session-secret",
    })).toBe("actor-secret");
  });

  it("uporabi obstoječo session skrivnost kot varni fallback", () => {
    expect(getPosActorSessionSecret({
      POS_ACTOR_SESSION_SECRET: undefined,
      SESSION_SECRET: "session-secret",
    })).toBe("session-secret");
  });

  it("brez obeh skrivnosti odpove zaprto", () => {
    expect(getPosActorSessionSecret({
      POS_ACTOR_SESSION_SECRET: undefined,
      SESSION_SECRET: undefined,
    })).toBeNull();
  });
});