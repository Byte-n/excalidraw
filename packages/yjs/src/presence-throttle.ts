export const createPresenceThrottle = (
  intervalMs: number,
  emit: () => void,
  now: () => number = () => performance.now(),
) => {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    last = now();
    emit();
  };
  return {
    schedule: () => {
      const remaining = intervalMs - (now() - last);
      if (remaining <= 0) {
        flush();
        return;
      }
      if (timer === null) {
        timer = setTimeout(flush, remaining);
      }
    },
    flush,
    markSent: () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      last = now();
    },
    cancel: () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = null;
    },
  };
};
