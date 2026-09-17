import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { Score } from '@/core/model/score';
import { ScoreParseError } from '@/core/parsers/errors';
import { parseJsonScore, serializeScore } from '@/core/parsers/jsonScore';
import { parseMidi } from '@/core/parsers/midi';
import { guessTextFormat, type TextFormat } from './scoreInfo';

/** 文件选择对话框的过滤器（设计 01 第 4.2 节） */
export const SCORE_FILE_FILTERS = [{ name: '乐谱文件', extensions: ['mid', 'midi', 'txt', 'json'] }];

/** 打开「选择乐谱文件」对话框；取消时返回 null */
export async function pickScoreFile(): Promise<string | null> {
  const path = await open({ multiple: false, title: '打开乐谱', filters: SCORE_FILE_FILTERS });
  return typeof path === 'string' ? path : null;
}

export function readScoreFile(path: string): Promise<Uint8Array> {
  return readFile(path);
}

/** 保存 JSON 谱，默认文件名 `<标题>.json`；取消时返回 false */
export async function writeScoreJson(title: string, score: Score): Promise<boolean> {
  const path = await save({
    title: '导出 JSON 谱',
    defaultPath: `${title}.json`,
    filters: [{ name: 'JSON 谱', extensions: ['json'] }],
  });
  if (typeof path !== 'string') return false;
  await writeTextFile(path, serializeScore(score));
  return true;
}

export type ParsedScoreFile =
  | { kind: 'score'; score: Score }
  | { kind: 'text'; title: string; text: string; guess: TextFormat };

/** 按扩展名解析乐谱文件；.txt 返回文本和格式猜测，由调用方打开文本乐谱对话框（设计 01 第 4.2 节） */
export function parseScoreFile(fileName: string, data: Uint8Array): ParsedScoreFile {
  const ext = (/\.[^.]+$/.exec(fileName)?.[0] ?? '').toLowerCase();
  const title = fileName.slice(0, fileName.length - ext.length);
  if (ext === '.mid' || ext === '.midi') return { kind: 'score', score: parseMidi(data, title) };
  const text = new TextDecoder().decode(data);
  if (ext === '.json') return { kind: 'score', score: parseJsonScore(text) };
  if (ext === '.txt') return { kind: 'text', title, text, guess: guessTextFormat(text) };
  throw new ScoreParseError(`不支持的文件类型「${ext || fileName}」，请使用 .mid / .midi / .txt / .json`);
}
