<?php
declare(strict_types=1);
namespace MediaWiki\Output {
    class OutputPage {
        public array $classes = [], $styles = [], $modules = [];
        public string $htmlTitle = 'Canonical browser title', $pageTitle = '';
        public function __construct(public ?object $title, public string $action = 'view') {}
        public function getTitle(): ?object { return $this->title; }
        public function getContext(): object { return new class($this->action) {
            public function __construct(private string $action) {}
            public function getActionName(): string { return $this->action; }
        }; }
        public function addBodyClasses(string $s): void { $this->classes[] = $s; }
        public function addModuleStyles(array $s): void { $this->styles = $s; }
        public function addModules(array $s): void { $this->modules = $s; }
        public function getHTMLTitle(): string { return $this->htmlTitle; }
        public function setHTMLTitle(string $s): void { $this->htmlTitle = $s; }
        public function setPageTitle(string $s): void { $this->pageTitle = $s; $this->htmlTitle = $s; }
    }
}
namespace {
    const NS_MAIN = 0;
    class Skin {}
    require __DIR__ . '/../presentation/module/includes/Hooks.php';
    function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
    function title(string $key, int $namespace = 0): object { return new class($key, $namespace) {
        public function __construct(private string $key, private int $namespace) {}
        public function getDBkey(): string { return $this->key; }
        public function getText(): string { return str_replace('_', ' ', $this->key); }
        public function getNamespace(): int { return $this->namespace; }
    }; }
    foreach ([null, title('Other'), title('PvME/Guide', 1)] as $t) {
        $out = new \MediaWiki\Output\OutputPage($t);
        \MediaWiki\Extension\PvmePresentation\Hooks::onBeforePageDisplay($out, new Skin());
        check($out->classes === [] && $out->modules === [], 'Unrelated titles must be untouched');
    }
    $canonical = title('PvME/Boss/Guide_<example>');
    $out = new \MediaWiki\Output\OutputPage($canonical);
    \MediaWiki\Extension\PvmePresentation\Hooks::onBeforePageDisplay($out, new Skin());
    check($out->modules === ['ext.pvmePresentation.reader'], 'View loads reader');
    check($out->pageTitle === 'Guide &lt;example&gt;', 'Visible heading must be escaped');
    check($out->htmlTitle === 'Canonical browser title' && $out->title === $canonical, 'Canonical identity must survive');
    $edit = new \MediaWiki\Output\OutputPage($canonical, 'edit');
    \MediaWiki\Extension\PvmePresentation\Hooks::onBeforePageDisplay($edit, new Skin());
    check($edit->modules === [] && $edit->pageTitle === '', 'Editor must not load reader or shorten title');
    echo "Presentation title, namespace and editor gates passed.\n";
}
