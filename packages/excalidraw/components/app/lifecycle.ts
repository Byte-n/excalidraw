import type App from "../App";
import type { AppProps, AppState } from "../../types";

/** Lifecycle coordination kept outside the React shell. */
export const initializeScene = (app: App) => app.initializeSceneImpl();

export const componentDidMount = (app: App) => app.componentDidMountImpl();

export const componentWillUnmount = (app: App) =>
  app.componentWillUnmountImpl();

export const componentDidUpdate = (
  app: App,
  prevProps: AppProps,
  prevState: AppState,
) => app.componentDidUpdateImpl(prevProps, prevState);

export const handleInteractionStateChange = (
  app: App,
  prevProps: AppProps,
  prevState: AppState,
) => app.handleInteractionStateChangeImpl(prevProps, prevState);

export const handleForcedToolChange = (
  app: App,
  prevProps: AppProps,
  prevState: AppState,
) => app.handleForcedToolChangeImpl(prevProps, prevState);
