// Skill trees are fixed, team-reviewed data in data/roles.json (shared by every dataset).
import rolesJson from '../data/roles.json';
import type { Role, Skill } from './types';

export const ROLES = rolesJson as Role[];

export const availableRoles = () => ROLES.filter((r) => r.status === 'available');

export function findRole(id: string): Role | undefined {
  return ROLES.find((r) => r.id === id);
}

export type SkillWithRole = Skill & { roleId: string; roleName: string };

export const SKILLS: SkillWithRole[] = ROLES.flatMap((r) => r.skills.map((s) => ({ ...s, roleId: r.id, roleName: r.name })));
export const skillById = new Map(SKILLS.map((s) => [s.id, s]));
