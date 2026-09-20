import { Fragment, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type InstrumentProfile, voiceLabel } from '@/core/model/instrument';
import { keyLabel } from '@/core/model/keycodes';
import { midiToNoteName } from '@/core/music/pitch';
import { useInstrumentStore } from '@/stores/instrumentStore';

function pitchRange(profile: InstrumentProfile): { min: number; max: number } | null {
  let min: number | undefined;
  let max: number | undefined;
  for (const row of profile.rows) {
    for (const key of row.keys) {
      const notes = key.pitch !== undefined ? [key.pitch] : (key.chord ?? []);
      for (const note of notes) {
        min = min === undefined ? note : Math.min(min, note);
        max = max === undefined ? note : Math.max(max, note);
      }
    }
  }
  return min === undefined || max === undefined ? null : { min, max };
}

/** 鼓映射按音色分组：一行一个音色，音符号升序；音色顺序取其最小音符号的先后 */
function groupDrumNotesByVoice(drumNotes: Record<string, string>): [string, number[]][] {
  const groups = new Map<string, number[]>();
  for (const [note, voice] of Object.entries(drumNotes)) {
    const list = groups.get(voice) ?? [];
    list.push(Number(note));
    groups.set(voice, list);
  }
  return [...groups.entries()]
    .map(([voice, notes]) => [voice, notes.sort((a, b) => a - b)] as [string, number[]])
    .sort((a, b) => a[1][0] - b[1][0]);
}

function OverviewRows({ profile }: { profile: InstrumentProfile }) {
  const range = profile.kind === 'pitched' ? pitchRange(profile) : null;
  const chordKeys = profile.rows.flatMap((row) => row.keys).filter((key) => key.chord !== undefined);
  const rows: [string, ReactNode][] = [];
  const push = (label: string, value: ReactNode) => rows.push([label, value]);

  push('类型', <>{profile.kind === 'pitched' ? '音高类' : '敲击类'}</>);
  push(
    '状态',
    profile.status === 'verified' ? (
      <Badge variant="secondary">已验证</Badge>
    ) : (
      <Badge variant="outline">待实测</Badge>
    ),
  );
  push('键位', <>{profile.rows.length} 行 · {profile.rows.reduce((sum, row) => sum + row.keys.length, 0)} 键</>);
  if (range) {
    push(
      '音域',
      <>
        <span className="font-mono">{midiToNoteName(range.min)} – {midiToNoteName(range.max)}</span>
        <span className="text-muted-foreground">（MIDI {range.min}–{range.max}）</span>
      </>,
    );
  }
  if (chordKeys.length > 0) {
    push(
      '和弦键',
      <>
        {chordKeys.length} 个（{chordKeys.map((key) => key.label).join('、')}）
      </>,
    );
  }
  push('按住时长', <>{profile.timing.holdMs}ms</>);
  push('最小重复间隔', <>{profile.timing.minRepeatGapMs}ms</>);
  push('持续发声', <>{profile.timing.sustain ? '可持续' : '不可持续'}</>);
  if (profile.kind === 'percussion' && profile.percussionMap) {
    push(
      '分界音高',
      profile.percussionMap.splitPitch === 'auto' ? (
        <>自动（按音轨音高的中位数）</>
      ) : (
        <>
          <span className="font-mono">{midiToNoteName(profile.percussionMap.splitPitch)}</span>
          <span className="text-muted-foreground">（MIDI {profile.percussionMap.splitPitch}）</span>
        </>
      ),
    );
  }

  return (
    <div className="mb-6 overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className="w-28 bg-muted/50 px-2.5 py-1.5 text-left font-medium">
                {label}
              </th>
              <td className="border-t px-2.5 py-1.5 leading-6">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyTables({ profile }: { profile: InstrumentProfile }) {
  return (
    <>
      {profile.rows.map((row, index) => (
        <Fragment key={index}>
          <h3 className="mt-6 mb-2 text-base font-semibold">
            第 {index + 1} 行 · {row.label}
          </h3>
          <div className="mb-2 overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-medium">键</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">
                    {profile.kind === 'pitched' ? '定音' : '音色'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {row.keys.map((key) => (
                  <tr key={key.code}>
                    <td className="border-t px-2.5 py-1.5">
                      <span className="font-mono">{keyLabel(key.code)}</span>
                    </td>
                    <td className="border-t px-2.5 py-1.5 leading-6">
                      {key.pitch !== undefined ? (
                        <>
                          <span className="font-mono">{midiToNoteName(key.pitch)}</span>{' '}
                          <span className="text-muted-foreground">MIDI {key.pitch}</span>
                        </>
                      ) : key.chord !== undefined ? (
                        <>
                          {key.label}（和弦）{' '}
                          <span className="font-mono">{key.chord.map(midiToNoteName).join(' · ')}</span>
                        </>
                      ) : (
                        <>
                          {voiceLabel(key.voice ?? '')}
                          {key.voice && <span className="text-muted-foreground"> · {key.voice}</span>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fragment>
      ))}
    </>
  );
}

/** 帮助页「乐器参数」：按当前乐器列表（含自定义）生成参数速查表，数据与演奏页同源 */
export function InstrumentParams() {
  const entries = useInstrumentStore((state) => state.entries);
  const [selectedId, setSelectedId] = useState(entries[0]?.profile.id);
  const builtin = entries.filter((entry) => entry.builtin);
  const custom = entries.filter((entry) => !entry.builtin);
  const profile = entries.find((entry) => entry.profile.id === selectedId)?.profile ?? entries[0]?.profile;

  if (!profile) return <p className="text-sm text-muted-foreground">还没有可用乐器。</p>;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold tracking-tight">乐器参数</h1>
      <p className="mb-4 text-sm leading-6 text-muted-foreground">
        键位、定音和时序参数都在这里，跟演奏页、乐器页用的是同一份数据，自定义乐器也会出现在下拉里。按住时长和最小重复间隔是实测出来的「游戏能可靠识别按键」的下限，自建乐器时改小可能漏音。
      </p>
      <div className="mb-4 max-w-72">
        <Select value={profile.id} onValueChange={setSelectedId}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>内置</SelectLabel>
              {builtin.map((entry) => (
                <SelectItem key={entry.profile.id} value={entry.profile.id}>
                  {entry.profile.name}
                </SelectItem>
              ))}
            </SelectGroup>
            {custom.length > 0 && (
              <SelectGroup>
                <SelectLabel>自定义</SelectLabel>
                {custom.map((entry) => (
                  <SelectItem key={entry.profile.id} value={entry.profile.id}>
                    {entry.profile.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </div>

      <h2 className="mt-2 mb-2 text-lg font-semibold">概览</h2>
      <OverviewRows profile={profile} />

      <h2 className="mt-2 mb-1 text-lg font-semibold">键位布局</h2>
      <KeyTables profile={profile} />

      {profile.kind === 'percussion' && profile.percussionMap && (
        <>
          <h2 className="mt-8 mb-2 text-lg font-semibold">鼓映射表（MIDI 音符号 → 音色）</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-medium">音色</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">音符号（音名）</th>
                </tr>
              </thead>
              <tbody>
                {groupDrumNotesByVoice(profile.percussionMap.drumNotes).map(([voice, notes]) => (
                  <tr key={voice}>
                    <td className="border-t px-2.5 py-1.5">
                      {voiceLabel(voice)}
                      <span className="text-muted-foreground"> · {voice}</span>
                    </td>
                    <td className="border-t px-2.5 py-1.5 font-mono leading-6">
                      {notes.map((note) => `${note}（${midiToNoteName(note)}）`).join('、')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            鼓轨（MIDI 第 10 通道）的音符按这张表映射到音色。分界音高只管写在普通音轨上的音：低于分界线的音去找「咚」键，其余找「咔」键；乐器上没有咚、咔音色时（比如聚聚鼓），这些音会按「未映射」丢弃，这时到演奏页用「指定音符」把它们逐个指到谱里实际的音符。
          </p>
        </>
      )}
    </div>
  );
}
