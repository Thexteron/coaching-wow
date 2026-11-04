"""Construit les données du site public (data.js, data_version.txt, icons/) à partir des jeux du tableau de bord.

Usage (depuis la racine du dépôt) :
  python3 outils/site_data.py version <meta>
      Affiche l'empreinte des jeux de données (change dès qu'un jeu est republié).
      <meta> : fichier JSON {"<nom du jeu>": "/_blob/<id>", ...} recopié depuis le source.url de chaque document
      de la collection "datasets" (ArtifactData "list"), ou dossier contenant ces documents en <nom>.json.
  python3 outils/site_data.py build <meta> <fichiers> "<JJ/MM/AAAA à HHhMM>"
      <fichiers> : dossier (cherché récursivement) où l'outil Artifact a enregistré les fichiers des jeux
      (<id>.json) et des icônes (<id>.jpg). Écrit data.js et data_version.txt, copie les icônes trouvées dans
      icons/, puis affiche « JEU_MANQUANT <id> » ou « ICONE_MANQUANTE <id> » pour ce qui reste à télécharger
      (relancer la même commande après les avoir téléchargés). Code de sortie 2 s'il manque un jeu.
Les lignes de raid ne sont pas publiées.
"""
import hashlib
import json
import os
import shutil
import sys

NAMES = ['characters', 'runs', 'run_metrics', 'metrics', 'reports', 'report_items', 'comparisons', 'timeline',
         'cd_events', 'fiche_items', 'groups', 'route_items', 'pull_items', 'death_items', 'kick_items', 'icon_map']
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def meta_of(meta_dir):
    if os.path.isfile(meta_dir):
        # fichier JSON {nom du jeu: "/_blob/<id>" ou "<id>"}
        raw = json.load(open(meta_dir, encoding='utf-8'))
        return {n: str(raw[n]).replace('/_blob/', '').strip() for n in NAMES if raw.get(n)}
    base = os.path.join(meta_dir, 'datasets') if os.path.isdir(os.path.join(meta_dir, 'datasets')) else meta_dir
    out = {}
    for n in NAMES:
        p = os.path.join(base, n + '.json')
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding='utf-8'))
        d = d.get('data', d)  # document brut ou seulement ses champs
        url = ((d.get('source') or {}).get('url') or '')
        if url.startswith('/_blob/'):
            out[n] = url[len('/_blob/'):]
    return out


def version(meta):
    s = '|'.join('%s:%s' % (n, meta[n]) for n in NAMES if n in meta)
    return hashlib.sha1(s.encode()).hexdigest()[:16]


def index_files(folder):
    found = {}
    for dirpath, _, files in os.walk(folder):
        for f in files:
            stem, ext = os.path.splitext(f)
            if ext in ('.json', '.jpg'):
                found.setdefault(stem + ext, os.path.join(dirpath, f))
    return found


def is_raid(r):
    if r.get('content') == 'Raid':
        return True
    for k in ('run_id', 'row_id', 'item_id', 'group_id', 'report_id', 'key_id'):
        v = r.get(k)
        if isinstance(v, str) and '-raid-' in v:
            return True
    return False


def build(meta_dir, files_dir, stamp):
    meta = meta_of(meta_dir)
    files = index_files(files_dir)
    missing_sets = [meta[n] for n in NAMES if n in meta and meta[n] + '.json' not in files]
    if missing_sets:
        for i in missing_sets:
            print('JEU_MANQUANT', i)
        return 2
    D = {}
    for n in NAMES:
        rows = json.load(open(files[meta[n] + '.json'], encoding='utf-8')) if n in meta else []
        D[n] = [r for r in rows if isinstance(r, dict) and not is_raid(r)]
    icons_dir = os.path.join(ROOT, 'icons')
    os.makedirs(icons_dir, exist_ok=True)
    missing_icons = set()
    for k in ('cd_events', 'fiche_items', 'icon_map'):
        for r in D[k]:
            v = r.get('icon')
            if isinstance(v, str) and v.startswith('/_blob/'):
                i = v[len('/_blob/'):]
                dst = os.path.join(icons_dir, i + '.jpg')
                if not os.path.exists(dst):
                    src = files.get(i + '.jpg')
                    if src:
                        shutil.copyfile(src, dst)
                    else:
                        missing_icons.add(i)
                r['icon'] = 'icons/' + i + '.jpg'
    with open(os.path.join(ROOT, 'data.js'), 'w', encoding='utf-8') as f:
        f.write('window.__DATA=' + json.dumps(D, ensure_ascii=False, separators=(',', ':'))
                + ';window.__DATA_AT=' + json.dumps(stamp, ensure_ascii=False) + ';')
    with open(os.path.join(ROOT, 'data_version.txt'), 'w') as f:
        f.write(version(meta) + '\n')
    print('data.js écrit :', ', '.join('%s %d' % (n, len(D[n])) for n in NAMES))
    for i in sorted(missing_icons):
        print('ICONE_MANQUANTE', i)
    return 0


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == 'version':
        print(version(meta_of(sys.argv[2])))
        return 0
    if len(sys.argv) >= 5 and sys.argv[1] == 'build':
        return build(sys.argv[2], sys.argv[3], sys.argv[4])
    print(__doc__)
    return 1


if __name__ == '__main__':
    sys.exit(main())
