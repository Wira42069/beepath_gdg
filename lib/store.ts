'use client';
// Browser-only persistence: no accounts, no student data.
// Progress, completed certificates and this device's own ratings live in localStorage, with an
// in-memory fallback if storage is blocked. Ratings are ALSO sent (anonymously) to the server,
// so they can change the ranking for other students.
import { useSyncExternalStore } from 'react';

const PREFIX = 'beepath.v1.';
const mem = new Map<string, unknown>();
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.value as T; // stable identity for useSyncExternalStore
    const value = raw ? (JSON.parse(raw) as T) : fallback;
    cache.set(key, { raw, value });
    return value;
  } catch {
    return mem.has(key) ? (mem.get(key) as T) : fallback;
  }
}

function write(key: string, value: unknown) {
  mem.set(key, value);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage blocked: memory only
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith(PREFIX)) listener(); };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** A random id for this browser. Sent with ratings so a re-rating replaces the old one; never tied to a person. */
export function anonId(): string {
  let id = read<string | null>('anonId', null);
  if (!id) {
    id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now()}`;
    write('anonId', id);
  }
  return id;
}

// ---- Skill progress: { [roleId]: { [skillId]: 'doing' | 'done' } } ----
export type Status = 'todo' | 'doing' | 'done';
export type Progress = Record<string, Record<string, Exclude<Status, 'todo'>>>;
const EMPTY_PROGRESS: Progress = {};

export const getProgress = () => read<Progress>('progress', EMPTY_PROGRESS);
export function statusOf(progress: Progress, roleId: string, skillId: string): Status {
  return progress[roleId]?.[skillId] || 'todo';
}
export function setStatus(roleId: string, skillId: string, status: Status) {
  const all = structuredClone(getProgress());
  all[roleId] = all[roleId] || {};
  if (status === 'todo') delete all[roleId][skillId];
  else all[roleId][skillId] = status;
  write('progress', all);
}

// ---- This device's ratings: { 'certId|skillId': { stars, relevant, ts, synced } } ----
export type MyRating = { stars: number; relevant: boolean; ts: number; synced?: boolean };
export type MyRatings = Record<string, MyRating>;
const EMPTY_RATINGS: MyRatings = {};

export const getMyRatings = () => read<MyRatings>('ratings', EMPTY_RATINGS);
export function setMyRating(certId: string, skillId: string, r: { stars: number; relevant: boolean; synced?: boolean }) {
  const all = { ...getMyRatings() };
  all[`${certId}|${skillId}`] = { stars: r.stars, relevant: r.relevant, synced: r.synced, ts: Date.now() };
  write('ratings', all);
}

export function exportRatings(datasetId: string) {
  const mine = getMyRatings();
  return {
    datasetId,
    anonId: anonId(),
    exportedAt: new Date().toISOString(),
    ratings: Object.entries(mine).map(([k, r]) => {
      const [certificateId, skillId] = k.split('|');
      return { certificateId, skillId, stars: r.stars, relevant: r.relevant };
    }),
  };
}

// ---- Completed certificates: { [certId]: { skillId, completedOn: 'YYYY-MM', submittedToBinus, ts } } ----
// "Submitted to Binus" is self-reported: BeePath cannot see the campus system.
export type Completed = Record<string, { skillId: string | null; completedOn: string; submittedToBinus: boolean; ts: number }>;
const EMPTY_COMPLETED: Completed = {};

export const getCompleted = () => read<Completed>('completed', EMPTY_COMPLETED);
export function setCompleted(certId: string, skillId: string | null, completedOn: string) {
  const all = { ...getCompleted() };
  if (all[certId]) return;
  all[certId] = { skillId: skillId || null, completedOn, submittedToBinus: false, ts: Date.now() };
  write('completed', all);
}
export function updateCompleted(certId: string, patch: Partial<Completed[string]>) {
  const all = { ...getCompleted() };
  if (!all[certId]) return;
  all[certId] = { ...all[certId], ...patch };
  write('completed', all);
}
export function removeCompleted(certId: string) {
  const all = { ...getCompleted() };
  delete all[certId];
  write('completed', all);
}

/**
 * React hook over one stored value. Renders the empty fallback on the server and during
 * hydration, then the stored value, so server HTML and the first client render always match.
 */
export function useStored<T>(get: () => T, empty: T): T {
  return useSyncExternalStore(subscribe, get, () => empty);
}
export const useProgress = () => useStored(getProgress, EMPTY_PROGRESS);
export const useMyRatings = () => useStored(getMyRatings, EMPTY_RATINGS);
export const useCompleted = () => useStored(getCompleted, EMPTY_COMPLETED);
