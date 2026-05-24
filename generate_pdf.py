from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
import re

input_path = 'CLIENT_READY_RECKONER.md'
output_path = 'CLIENT_READY_RECKONER.pdf'

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='Heading1', parent=styles['Heading1'], fontSize=18, leading=22, spaceAfter=12))
styles.add(ParagraphStyle(name='Heading2', parent=styles['Heading2'], fontSize=14, leading=18, spaceAfter=10))
styles.add(ParagraphStyle(name='BodyText', parent=styles['BodyText'], fontSize=11, leading=14, spaceAfter=6))
styles.add(ParagraphStyle(name='Bullet', parent=styles['BodyText'], leftIndent=18, bulletIndent=9, spaceBefore=0, spaceAfter=0))

with open(input_path, 'r', encoding='utf-8') as f:
    lines = [line.rstrip('\n') for line in f]

story = []
for line in lines:
    if not line.strip():
        story.append(Spacer(1, 6))
        continue
    if line.startswith('# '):
        story.append(Paragraph(line[2:].strip(), styles['Heading1']))
        continue
    if line.startswith('## '):
        story.append(Paragraph(line[3:].strip(), styles['Heading2']))
        continue
    if line.startswith('### '):
        story.append(Paragraph(line[4:].strip(), styles['Heading2']))
        continue
    m = re.match(r'^(\s*)[-*+]\s+(.*)', line)
    if m:
        story.append(Paragraph(m.group(2), styles['Bullet'], bulletText='•'))
        continue
    story.append(Paragraph(line, styles['BodyText']))


doc = SimpleDocTemplate(output_path, pagesize=letter, rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=40)
doc.build(story)
print(f'Created {output_path}')
