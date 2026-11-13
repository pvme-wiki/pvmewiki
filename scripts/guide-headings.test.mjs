import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshGuideContents } from './guide-headings.mjs';

const nav = '<nav aria-label="On this page"><a class="toc-h2" href="#old">Old title</a></nav>';
const page = '<header><h1>Reader title</h1></header><aside><details open class="contents-disclosure"><summary>On this page</summary>' + nav + '</details></aside><article class="source-content">Original body sentinel</article>';

test('published contents reflects added, removed and renamed rendered headings, not legacy alias spans', () => {
  const body = '<span id="old"></span><h2 id="md-guide:b:001-1">New <em>section</em></h2><h3 id="md-guide:b:001-2">A second heading</h3><p>Body</p>';
  const updated = refreshGuideContents(page, body);
  assert.match(updated, /class="toc-h2" href="#md-guide%3Ab%3A001-1">New section<\/a>/);
  assert.match(updated, /class="toc-h3" href="#md-guide%3Ab%3A001-2">A second heading<\/a>/);
  assert.doesNotMatch(updated, /href="#old"|>Old title</);
  assert.equal((updated.match(/<a /g) || []).length, 2);
  assert.equal(updated.slice(updated.indexOf('<article')), page.slice(page.indexOf('<article')));
  assert.equal(refreshGuideContents(updated, body), updated);
});

test('all heading levels and deep anchors retain readable text, entities and ability-image names', () => {
  const body = '<div><h1 id="one">One</h1><div><h2 id="two">Two &amp; more</h2><h3 id="three">Use <img class="d-emoji" alt="dragonbreath" src="/ability.png"> then <strong>Surge</strong></h3><h4 id="four">Four<br>lines</h4><h5 id="five">Five</h5><h6 id="phase/6?mode=hm&amp;detail=yes">Six</h6></div></div>';
  const updated = refreshGuideContents(page, body);
  for (let level = 1; level <= 6; level++) assert.match(updated, new RegExp('class="toc-h' + level + '"'));
  assert.match(updated, />Two &amp; more<\/a>/);
  assert.match(updated, />Use dragonbreath then Surge<\/a>/);
  assert.match(updated, />Four lines<\/a>/);
  assert.match(updated, /href="#phase%2F6%3Fmode%3Dhm%26detail%3Dyes"/);
  assert.equal((updated.match(/<a /g) || []).length, 6);
});

test('unsafe-looking heading labels and anchors become escaped text and fragment-only URLs', () => {
  const body = '<h2 id="&quot; onclick=&quot;alert(1)&quot;">&lt;script&gt;alert(1)&lt;/script&gt; <img alt="&lt;svg onload=boom&gt;" src="/image.png"></h2><h3 id="javascript:alert(2)">x &quot; y &amp; z</h3>';
  const updated = refreshGuideContents(page, body);
  assert.match(updated, /href="#%22%20onclick%3D%22alert\(1\)%22"/);
  assert.match(updated, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &lt;svg onload=boom&gt;/);
  assert.match(updated, /href="#javascript%3Aalert\(2\)"/);
  assert.match(updated, />x &quot; y &amp; z<\/a>/);
  assert.doesNotMatch(updated, /<script|<svg|href="javascript:|" onclick="/);
});

test('inert markup, comments, unanchored or empty headings and duplicate IDs do not invent entries', () => {
  const body = '<!-- <h2 id="comment">Comment</h2> --><script><style>fake nesting</style><h2 id="script">Script</h2></script><style><h2 id="style">Style</h2></style><template><script><template><h2 id="fake">Fake</h2></template></script><h2 id="template">Template</h2></template><h2>No anchor</h2><h2 id="">Empty id</h2><h2 id="blank">   </h2><h2 id="same">First</h2><h3 id="same">Second</h3><h2 id="line&#10;break">Bad id</h2>';
  const updated = refreshGuideContents(page, body);
  assert.equal((updated.match(/<a /g) || []).length, 1);
  assert.match(updated, /href="#same">First<\/a>/);
  assert.doesNotMatch(updated, />Second<\/a>|href="#(?:comment|script|style|template|blank)"/);
});

test('labels are bounded without splitting surrogate pairs or decoding entities twice', () => {
  const body = '<h2 id="long">' + '🦀'.repeat(200) + '</h2><h2 id="literal">&amp;lt;literal&amp;gt; <img alt="&amp;lt;icon&amp;gt;" src="/a.png"></h2>';
  const updated = refreshGuideContents(page, body);
  const long = updated.match(/href="#long">([^<]*)<\/a>/)[1];
  assert.equal(Array.from(long).length, 160);
  assert.ok(long.endsWith('…'));
  assert.ok(long.isWellFormed());
  assert.match(updated, /href="#literal">&amp;lt;literal&amp;gt; &amp;lt;icon&amp;gt;<\/a>/);
});

test('removing every heading clears the existing links; other navs and source bodies stay byte-identical', () => {
  const other = '<nav aria-label="Other"><a href="/elsewhere/">Keep me</a></nav>';
  const mixed = other + page;
  const updated = refreshGuideContents(mixed, '<p>No headings remain</p>');
  assert.ok(updated.startsWith(other));
  assert.match(updated, /<nav aria-label="On this page"><\/nav>/);
  assert.ok(updated.endsWith('<article class="source-content">Original body sentinel</article>'));
  assert.equal(refreshGuideContents(other, '<h2 id="new">New</h2>'), other);
  assert.throws(() => refreshGuideContents(page, null), TypeError);
});
