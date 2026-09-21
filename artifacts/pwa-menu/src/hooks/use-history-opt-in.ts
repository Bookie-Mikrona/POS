import { useState, useEffect } from 'react';

const OPT_IN_KEY = 'bookie.history-opt-in.v1';

export function useHistoryOptIn() {
  const [optedIn, setOptedIn] = useState<boolean>(() => {
    return localStorage.getItem(OPT_IN_KEY) === 'true';
  });

  const setOptIn = (value: boolean) => {
    setOptedIn(value);
    localStorage.setItem(OPT_IN_KEY, value ? 'true' : 'false');
  };

  return { optedIn, setOptIn };
}
