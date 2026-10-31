"""Fusionne la sortie de outils/cwx.js dans les jeux de données du tableau de bord Coaching WoW.

Usage : python3 outils/merge.py <dossier> <sortie.json> [<sortie2.json> ...]
  <dossier>     contient les jeux de données en <nom>.json (timeline, cd_events, pull_items, death_items, kick_items) ;
                un jeu absent est créé vide.
  <sortie.json> pour une clé : {"pulls": [...], "maps": [...], "traces": [...], "absent": [...], "deaths": [...],
                "kicks": [...], "vie": [...], "timeline": [...]}, c'est-à-dire CWX.part(nom) pour chaque nom.
Les lignes d'une clé (key_id) déjà présentes sont remplacées ; les champs de courbe (perf, self_k, heal_k, am,
hp_min) sont ajoutés aux lignes de timeline du même run_id et du même t. Affiche les jeux modifiés.
"""
import json
import os
import sys


def load(folder, name):
    p = os.path.join(folder, name + '.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []


def merge(D, out):
    keys = {r['key_id'] for k in ('pulls', 'maps', 'traces', 'absent', 'kicks', 'deaths') for r in out.get(k, [])}
    new_p = out.get('pulls', []) + out.get('maps', []) + out.get('traces', []) + out.get('absent', [])
    D['pull_items'] = [r for r in D['pull_items'] if r.get('key_id') not in keys] + new_p
    D['death_items'] = [r for r in D['death_items'] if r.get('key_id') not in keys] + out.get('deaths', [])
    D['kick_items'] = [r for r in D['kick_items'] if r.get('key_id') not in keys] + out.get('kicks', [])
    vie = out.get('vie', [])
    runs = {s['run_id'] for s in out.get('timeline', [])}
    D['cd_events'] = [r for r in D['cd_events'] if not (r.get('kind') == 'vie' and r.get('run_id') in runs)] + vie
    by_run = {}
    for r in D['timeline']:
        by_run.setdefault(r.get('run_id'), {})[r.get('t')] = r
    added = 0
    for s in out.get('timeline', []):
        rows = by_run.setdefault(s['run_id'], {})
        step = s.get('step', 10)
        series = {k: str(v).split(',') for k, v in s.items() if k not in ('character', 'run_id', 'step')}
        n = max((len(v) for v in series.values()), default=0)
        sample = next(iter(rows.values()), None)
        for i in range(n):
            t = i * step
            row = rows.get(t)
            if row is None:
                row = {'row_id': s['run_id'] + '-toi-' + str(t), 'character': s['character'],
                       'group_id': sample['group_id'] if sample else None, 'run_id': s['run_id'], 'who': 'Toi', 't': t, 'dtps': None}
                D['timeline'].append(row)
                rows[t] = row
                added += 1
            for k, v in series.items():
                val = v[i] if i < len(v) else ''
                row[k] = None if val in ('', 'null', 'None') else (float(val) if '.' in val else int(val))
    return added


def main():
    folder, outs = sys.argv[1], sys.argv[2:]
    names = ('timeline', 'cd_events', 'pull_items', 'death_items', 'kick_items')
    D = {n: load(folder, n) for n in names}
    for o in outs:
        added = merge(D, json.load(open(o, encoding='utf-8')))
        print(o, ': lignes de courbe créées', added)
    for n in names:
        json.dump(D[n], open(os.path.join(folder, n + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        print(n, len(D[n]), 'lignes')


if __name__ == '__main__':
    main()
