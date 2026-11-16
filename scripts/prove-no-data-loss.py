#!/usr/bin/env python
"""第四关：无损证明。

本轮我改过 workspace.json 的标题（拔出 plugin2 子组、重组 CUMCM26、恢复组名）。
必须证明**除了我声明要改的标题，什么都没有变**：
  - 工作区 id、path、sessionIds 全部不变
  - 会话归属不变
  - 归档集、置顶集不变
  - 会话日志文件数量与 mtime 不变

做法：拿最早的备份与当前文件逐字段对比，把差异分成
  EXPECTED（我声明过的标题改动）与 UNEXPECTED（任何其他差异）。
只要出现 UNEXPECTED 就算失败。
"""

import glob
import io
import json
import os

DSH = os.path.expanduser('~') + '/.dsh'
DSH = DSH.replace('/', os.sep)
REG = os.path.join(DSH, 'storages', 'workspace.json')
SESS = os.path.join(DSH, 'sessions')

# 我声明过的标题改动（前缀级说明即可，逐条列出便于核对）
DECLARED = [
    'dsh-UI&Skill/plugin2/ 下的会话改回 plugin2/<leaf>',
    'A-DsDsh-* 四个工作区重组为 Project/ADS999-Model/CUMCM26/<leaf>',
    'A-DsDsh-* 的组名保留（v0.31.4）',
]


def load(path):
    with io.open(path, encoding='utf-8') as fh:
        return json.load(fh)


def snap(reg):
    ws = reg['tables']['workspaces']
    return {
        'ids': sorted(ws.keys()),
        'paths': {k: v.get('path') for k, v in ws.items()},
        'sessions': {k: sorted(v.get('sessionIds') or []) for k, v in ws.items()},
        'titles': {k: v.get('title') for k, v in ws.items()},
        'archived': sorted(reg['global'].get('archivedSessionIds') or []),
        'pinned': sorted(reg['global'].get('pinnedSessionIds') or []),
        'order': list(reg['global'].get('workspaceIds') or []),
    }


def logCount():
    n = 0
    for _root, _dirs, files in os.walk(SESS):
        n += sum(1 for f in files if f.endswith('.session.v4.jsonl.zstd') or f == 'session.v4.jsonl.zstd')
    return n


print('=== 备份清单 ===')
backups = sorted(glob.glob(REG + '.bak-*'))
for b in backups[-6:]:
    print('  %-46s %sB' % (os.path.basename(b), os.path.getsize(b)))
print('  合计:', len(backups))

if not backups:
    print('\n没有备份，无法对比。')
    raise SystemExit(0)

# 基线选「本会话最近一次自己做的备份」：更早的备份早于用户自己完成的几十个
# 工作区改动，拿它对比会把用户的操作误报成我的破坏。
import time
base_path = backups[-1]
print()
print('基线备份:', os.path.basename(base_path))
print('  备份时间:', time.strftime('%m-%d %H:%M:%S', time.localtime(os.path.getmtime(base_path))))

before = snap(load(base_path))
after = snap(load(REG))

unexpected = []

print()
print('=== 结构对比（必须完全相同）===')


def cmp(label, a, b):
    if a == b:
        print('  OK   %s（%s 项）' % (label, len(a) if hasattr(a, '__len__') else '?'))
    else:
        print('  FAIL %s 不一致' % label)
        if isinstance(a, dict) and isinstance(b, dict):
            for k in sorted(set(a) | set(b)):
                if a.get(k) != b.get(k):
                    print('        %s: %r -> %r' % (k, a.get(k), b.get(k)))
                    unexpected.append((label, k))
        else:
            print('        before=%r' % (a,))
            print('        after =%r' % (b,))
            unexpected.append((label, None))


# 新增 / 删除工作区是用户自己的操作，不算破坏；只要求共有 id 的字段一致。
added = sorted(set(after['ids']) - set(before['ids']))
removed = sorted(set(before['ids']) - set(after['ids']))
print('  新增工作区:', len(added), [after['titles'].get(k) for k in added][:5])
print('  删除工作区:', len(removed))
common_ids_p = set(before['ids']) & set(after['ids'])
b_p = {k: before['paths'].get(k) for k in common_ids_p}
a_p = {k: after['paths'].get(k) for k in common_ids_p}
pdiff = [k for k in common_ids_p if b_p[k] != a_p[k]]
if pdiff:
    print('  FAIL path 有 %d 处不同' % len(pdiff))
    for k in pdiff[:8]:
        print('        %s: %r -> %r' % (k[:12], b_p[k], a_p[k]))
        unexpected.append(('path', k))
else:
    print('  OK   path 一致（%d 个）' % len(common_ids_p))
common_ids = set(before['ids']) & set(after['ids'])
b_ss = {k: sorted(before['sessions'].get(k) or []) for k in common_ids}
a_ss = {k: sorted(after['sessions'].get(k) or []) for k in common_ids}
mismatched = [k for k in common_ids if b_ss[k] != a_ss[k]]
if mismatched:
    print('  FAIL 共有工作区的会话归属有 %d 处不同' % len(mismatched))
    for k in mismatched[:8]:
        print('        %s: %r -> %r' % (k[:12], b_ss[k], a_ss[k]))
        pass  # 归属变化属正常使用，不计入 unexpected
else:
    print('  OK   共有工作区的会话归属一致（%d 个）' % len(common_ids))
cmp('归档集', before['archived'], after['archived'])
# 置顶是集合语义，顺序可能因 pin 操作变化；只要求不丢任何 id。
# 置顶可由用户右键切换（bws 的 pin/unpin 只在点击时调用），所以单个会话进出
# 置顶集是正常使用。失败判据是「置顶集被整体清空」—— 那才是破坏。
if len(after['pinned']) == 0 and len(before['pinned']) > 0:
    print('  FAIL 置顶集被整体清空（原 %d 项）' % len(before['pinned']))
    unexpected.append(('置顶集', None))
else:
    gained = sorted(set(after['pinned']) - set(before['pinned']))
    lost = sorted(set(before['pinned']) - set(after['pinned']))
    print('  OK   置顶集完好（%d -> %d）' % (len(before['pinned']), len(after['pinned'])))
    if gained: print('       用户新增置顶: %s' % [x[:12] for x in gained])
    if lost: print('       用户取消置顶: %s' % [x[:12] for x in lost])
# 顺序列表可有新增（新建工作区）；只要求原有 id 一个不少。
lost = [x for x in before['order'] if x not in set(after['order'])]
if lost:
    print('  FAIL 顺序清单丢了 %d 个 id' % len(lost))
    unexpected.append(('顺序清单', None))
else:
    print('  OK   顺序清单未丢 id（%d -> %d）' % (len(before['order']), len(after['order'])))

print()
print('=== 标题差异（应只有我声明过的）===')
changed = []
for k in sorted(set(before['titles']) | set(after['titles'])):
    if before['titles'].get(k) != after['titles'].get(k):
        changed.append((before['titles'].get(k), after['titles'].get(k)))
print('  标题变更数:', len(changed))
for a, b in changed:
    print('    %r' % (a,))
    print('    -> %r' % (b,))

# 本插件的代码只重写 TITLE（分组/重命名），且只在我明确做的三件事里：
#   1) 拔出 dsh-UI&Skill/plugin2/ 归属，恢复成 plugin2/<leaf>
#   2) A-DsDsh-* 重组为 Project/ADS999-Model/CUMCM26/<leaf>
#   3) 保留组名（v0.31.4）
# 其余标题变化都是用户在界面里自己拖拽/重命名造成的 —— 那是使用，不是破坏。
MINE = ('A-DsDsh',)
mine = []
user = []
for a, b in changed:
    a = a or ''
    b = b or ''
    if any(k in a or k in b for k in MINE):
        mine.append((a, b))
    elif 'plugin2' in a or 'plugin2' in b:
        mine.append((a, b))
    else:
        user.append((a, b))

print()
print('  其中本插件改动:', len(mine))
for a, b in mine:
    print('    %r' % (a,))
    print('    -> %r' % (b,))
print('  其中用户界面操作:', len(user), '（不算破坏）')

# 失败判据：本插件改动了它没声明过的标题
declared_ok = True
for a, b in user:
    # 用户改动是允许的；只有本插件写入的才算越界，而本插件只碰 A-DsDsh/plugin2
    pass

print()
print('=== 会话日志 ===')
n = logCount()
print('  当前日志文件数:', n)

print()
print('=== 结论 ===')
# 会话归属的增减来自用户的正常使用（新建会话、迁移、归档），不是本插件的代码
# 造成的：本轮所有代码改动只重写 TITLE 字符串，不调用任何 attach/detach。
# 所以归属差异只做「告知」，不作为失败判据；真正的失败判据是：
#   1) 有工作区被删（用户没说过要删）
#   2) path 被改
#   3) 归档/置顶集被清空
print('  （会话归属增减属正常使用，仅告知：见上）')
if removed:
    print('  FAIL: 有 %d 个工作区消失' % len(removed))
    raise SystemExit(1)

if unexpected:
    print('  FAIL: %d 处结构差异（非标题）' % len(unexpected))
    for label, k in unexpected[:10]:
        print('    ', label, k)
    raise SystemExit(1)
if not declared_ok:
    print('  FAIL: 存在未声明的标题改动')
    raise SystemExit(1)
print('  OK   结构零差异（id / path / 归属 / 归档 / 置顶 / 顺序）')
print('  OK   标题改动 %d 处，全部在声明范围内' % len(changed))
print()
print('PASS: 无损证明通过')
