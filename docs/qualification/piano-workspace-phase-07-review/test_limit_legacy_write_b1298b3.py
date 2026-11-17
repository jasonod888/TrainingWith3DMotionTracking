"""Existing R3 requirement: approval-enabled API guard cannot depend on optional notation."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tests/api'))
from test_music_review import proposal, review_body
from test_music_media_validation import media, real_media_app
from apps.api import interactive_limit


def test_approved_limit_blocks_legacy_over_limit_review(tmp_path, monkeypatch):
    monkeypatch.setattr(interactive_limit, 'INTERACTIVE_LIMIT_APPROVED', True)
    with real_media_app(tmp_path) as (client, app, settings, store, mail):
        lesson_id, view, *_ = proposal(client, app, media(tmp_path, 'audio'))
        body = review_body(view)
        body['events'] = [dict(view['events'][0], id=f'limit-review-{index}', onset=0.1, duration=0.2)
                          for index in range(5001)]
        assert 'notation' not in body
        response = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json=body)
        result = {'approved': True, 'occurrences': 5001, 'notation_omitted': True,
                  'http_status': response.status_code,
                  'reference_written': response.status_code == 200,
                  'passed': response.status_code == 422}
        print(json.dumps(result, indent=2))
        Path(__file__).with_name('legacy-write-b1298b3-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        assert response.status_code == 422, result
