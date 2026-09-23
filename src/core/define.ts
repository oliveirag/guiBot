import type { ClientEvents } from 'discord.js';
import type { Command, EventHandler, JobHandler, ModuleMeta } from './types.js';

// Identity helpers so each module file gets full type checking with one import.
export const command = (c: Command): Command => c;
export const event = <K extends keyof ClientEvents>(e: EventHandler<K>): EventHandler<K> => e;
export const job = (j: JobHandler): JobHandler => j;
export const moduleMeta = (m: ModuleMeta): ModuleMeta => m;
