"""Fusionne la sortie de outils/cwx.js dans les jeux de données du tableau de bord Coaching WoW.

Usage : python3 outils/merge.py <dossier> <sortie.json> [<sortie2.json> ...]
  <dossier>     contient les jeux de données en <nom>.json (timeline, cd_events, pull_items, death_items, kick_items) ;
                un jeu absent est créé vide.
  <sortie.json> pour une clé : {"pulls": [...], "maps": [...], "traces": [...], "absent": [...], "deaths": [...],
                "kicks": [...], "vie": [...], "timeline": [...]}, c'est-à-dire CWX.part(nom) pour chaque nom.

Une clé (key_id) peut être traitée en plusieurs fois, un perso à la fois : les chiffres des persos déjà présents
pour cette clé sont gardés (pulls, kicks), ceux des persos de la sortie sont remplacés ; les morts sont remplacées
pour les persos de la sortie. Les champs de courbe (perf, self_k, heal_k, am, hp_min) sont ajoutés aux lignes de
timeline du même run_id et du même t. Affiche les jeux modifiés.
"""
import json
import os
import sys


def load(folder, name):
    p = os.path.join(folder, name + '.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []


def v1_to_v2(x):
    return [x.get('p'), x.get('m'), x.get('lo'), x.get('hi'), x.get('d'), x.get('f'), x.get('mn'), x.get('k'), x.get('nt'), [], [], 0]


def merge_key_pulls(old_rows, new_rows):
    """Fusionne les lignes pull_items d'une même clé (format v2 : c[perso] tableaux, noms dans la ligne kind 'dict')."""
    old_dict = next((r for r in old_rows if r.get('kind') == 'dict'), None)
    new_dict = next((r for r in new_rows if r.get('kind') == 'dict'), None)
    names = list(old_dict['names']) if old_dict else []
    pos = {n: i for i, n in enumerate(names)}

    def remap(i):
        if new_dict is None or i is None or i < 0:
            return i
        nm = new_dict['names'][i]
        if nm not in pos:
            pos[nm] = len(names)
            names.append(nm)
        return pos[nm]

    old_pulls = {r['item_id']: r for r in old_rows if r.get('kind') == 'pull'}
    out = []
    for r in new_rows:
        if r.get('kind') == 'dict':
            continue
        if r.get('kind') != 'pull':
            out.append(r)
            continue
        r = dict(r)
        if r.get('hurt'):
            r['hurt'] = [[remap(a), y, t] for a, y, t in r['hurt']]
        c_new = {}
        for ch, arr in (r.get('c') or {}).items():
            arr = list(arr)
            if len(arr) > 9 and arr[9]:
                arr[9] = [[remap(n), [remap(y) for y in yon], pct, remap(on)] for n, yon, pct, on in arr[9]]
            if len(arr) > 10 and arr[10]:
                arr[10] = [[remap(n), y, t] for n, y, t in arr[10]]
            c_new[ch] = arr
        old = old_pulls.get(r['item_id'])
        c_old = {}
        if old:
            if old.get('c'):
                c_old = dict(old['c'])
            elif old.get('chars'):
                c_old = {ch: v1_to_v2(x) for ch, x in old['chars'].items()}
            if old.get('tank') and not r.get('tank'):
                r['tank'] = old['tank']
        c_old.update(c_new)
        r['c'] = c_old
        r.pop('chars', None)
        r['v'] = 2
        out.append(r)
    # pulls anciens absents de la nouvelle sortie (ne devrait pas arriver) : gardés
    seen = {r['item_id'] for r in out}
    for r in old_rows:
        if r.get('kind') == 'pull' and r['item_id'] not in seen:
            out.append(r)
    key = (new_rows or old_rows)[0]['key_id']
    out.append({'item_id': key + '-dict', 'key_id': key, 'kind': 'dict', 'names': names})
    return out


def merge(D, out):
    new_p = out.get('pulls', []) + out.get('maps', []) + out.get('traces', []) + out.get('absent', [])
    keys = {r['key_id'] for r in new_p} | {r['key_id'] for r in out.get('kicks', [])} | {r['key_id'] for r in out.get('deaths', [])}
    chars = {s['character'] for s in out.get('timeline', [])}
    for key in keys:
        old_k = [r for r in D['pull_items'] if r.get('key_id') == key]
        new_k = [r for r in new_p if r.get('key_id') == key]
        if not new_k:
            continue
        old_kinds_kept = [r for r in old_k if r.get('kind') in ('map', 'trace', 'absent') and not any(n.get('kind') == r.get('kind') for n in new_k)]
        cds_new = {r['item_id'] for r in new_k if r.get('kind') == 'cds'}
        old_cds = [r for r in old_k if r.get('kind') == 'cds' and r['item_id'] not in cds_new]
        merged = merge_key_pulls([r for r in old_k if r.get('kind') in ('pull', 'dict')], new_k)
        D['pull_items'] = [r for r in D['pull_items'] if r.get('key_id') != key] + merged + old_kinds_kept + old_cds
    # morts : remplacées pour les persos de la sortie
    D['death_items'] = [r for r in D['death_items'] if not (r.get('key_id') in keys and r.get('character') in chars)] + out.get('deaths', [])
    # kicks : mêmes chiffres de groupe, médianes des tops fusionnées par perso
    old_kicks = {r['item_id']: r for r in D['kick_items'] if r.get('key_id') in keys}
    new_ids = set()
    for r in out.get('kicks', []):
        o = old_kicks.get(r['item_id'])
        if o:
            t = dict(o.get('tops') or {})
            t.update(r.get('tops') or {})
            r = dict(r, tops=t)
        new_ids.add(r['item_id'])
        D['kick_items'] = [x for x in D['kick_items'] if x['item_id'] != r['item_id']] + [r]
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
