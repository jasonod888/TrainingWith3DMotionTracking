"""W2's incomplete-baseline case, retaining the legacy probe's safety assertion."""
from pathlib import Path
source=Path(__file__).with_name('check-legacy-reversal.py')
code=source.read_text(encoding='utf-8')
code=code.replace('delete c.acceptedBaselines;', "c.acceptedBaselines={'add-1':{}};")
code=code.replace('legacy-reversal-results.json','empty-baseline-results.json')
code=code.replace('legacy-checkpoint-refuses-reversal-without-authored-after-baseline',
                  'empty-accepted-baseline-refuses-destructive-reversal')
exec(compile(code,str(source),'exec'))
