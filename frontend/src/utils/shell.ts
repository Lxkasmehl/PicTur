export type Shell = 'plastron' | 'carapace';

/** Colour per shell, so the two are told apart at a glance wherever a photo is requested. */
export const SHELL_COLOR: Record<Shell, string> = { plastron: 'blue', carapace: 'orange' };
