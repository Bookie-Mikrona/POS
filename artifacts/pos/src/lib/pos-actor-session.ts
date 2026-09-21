export const POS_ACTOR_SESSION_CHANGED_EVENT = "pos-actor-session-changed";
export const POS_ACTOR_SESSION_REQUIRED_EVENT = "pos-actor-session-required";

export function notifyPosActorSessionChanged() {
  window.dispatchEvent(new Event(POS_ACTOR_SESSION_CHANGED_EVENT));
}

export function requestPosActorSession() {
  window.dispatchEvent(new Event(POS_ACTOR_SESSION_REQUIRED_EVENT));
}