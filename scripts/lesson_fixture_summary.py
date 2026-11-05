"""Summary projection for body-only browser fixtures; not application code."""


def body_summary(value):
    return dict(summary_version=1, lesson_id=value['lesson_id'], revision_id=value['revision_id'],
                title=value['title'], subject='movement_other', subject_label='Full Body Movement',
                experience_family='body', instrument=None, duration=value['duration'],
                section_count=len(value['section_set']['sections']), poster=value.get('thumbnail'),
                capabilities=dict(preview=True, practice=True, live_input='camera'))
