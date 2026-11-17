from pathlib import Path
p = Path('scripts/music_kong_adapter.py')
t = p.read_text(encoding='utf-8')
t = t.replace("""    (out / 'reference.json').write_text(json.dumps(draft, separators=(',', ':')),
                                       encoding='utf-8')
    render_preview(draft, native, args.input, out / 'preview.wav')""",
"""    preview_entry = render_preview(draft, native, args.input, out / 'preview.wav')
    draft['preview_identity'] = preview_entry['preview_identity']
    (out / 'reference.json').write_text(json.dumps(draft, separators=(',', ':')),
                                       encoding='utf-8')""")
p.write_text(t, encoding='utf-8')
print('adapter')
