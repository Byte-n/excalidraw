import type App from "../App";

/** Owns registration and teardown of the editor's native event listeners. */
export const addEventListeners = (app: App) => app.addEventListenersImpl();

export const removeEventListeners = (app: App) =>
  app.removeEventListenersImpl();
