<?php
declare(strict_types=1);

/*
 * Minimal stand-ins for the MediaWiki 1.43 classes the PvmePresentation extension uses,
 * so its tests run with plain PHP. Each one keeps the real name and the methods the
 * extension calls; the recording ones remember every call so a test can assert on
 * exactly what the extension did.
 */

namespace MediaWiki\Title {
    final class Title {
        public function __construct(private string $dbKey, private int $namespace = NS_MAIN) {
        }

        public function getDBkey(): string {
            return $this->dbKey;
        }

        public function getText(): string {
            return str_replace('_', ' ', $this->dbKey);
        }

        public function getNamespace(): int {
            return $this->namespace;
        }
    }
}

namespace MediaWiki\Output {
    use MediaWiki\Title\Title;

    /**
     * Records each OutputPage call as [method, ...arguments] in $calls.
     */
    final class OutputPage {
        /** @var list<array> */
        public array $calls = [];
        private string $pageTitle = '';

        public function __construct(
            private ?Title $title,
            private string $action = 'view',
            private string $htmlTitle = 'Canonical browser title'
        ) {
        }

        public function getTitle(): ?Title {
            return $this->title;
        }

        public function getContext(): RequestContext {
            return new RequestContext($this->action);
        }

        public function addBodyClasses(string $classes): void {
            $this->calls[] = ['addBodyClasses', $classes];
        }

        public function addMeta(string $name, string $content): void {
            $this->calls[] = ['addMeta', $name, $content];
        }

        public function addModuleStyles(array $modules): void {
            $this->calls[] = ['addModuleStyles', $modules];
        }

        public function addModules(array $modules): void {
            $this->calls[] = ['addModules', $modules];
        }

        public function getHTMLTitle(): string {
            return $this->htmlTitle;
        }

        public function setHTMLTitle(string $title): void {
            $this->calls[] = ['setHTMLTitle', $title];
            $this->htmlTitle = $title;
        }

        /** Like MediaWiki, setting the page heading also sets the browser title. */
        public function setPageTitle(string $html): void {
            $this->calls[] = ['setPageTitle', $html];
            $this->pageTitle = $html;
            $this->htmlTitle = $html;
        }

        public function getPageTitle(): string {
            return $this->pageTitle;
        }
    }

    final class RequestContext {
        public function __construct(private string $action) {
        }

        public function getActionName(): string {
            return $this->action;
        }
    }
}

namespace MediaWiki\Output\Hook {
    interface BeforePageDisplayHook {
        public function onBeforePageDisplay($out, $skin): void;
    }
}

namespace MediaWiki\Hook {
    interface ParserFirstCallInitHook {
        public function onParserFirstCallInit($parser);
    }
}

namespace MediaWiki\Parser {
    interface PPFrame {
    }

    /**
     * Holds the tag hooks registered with setHook and calls them the way MediaWiki does.
     */
    final class Parser {
        /** @var array<string,callable> */
        public array $tagHooks = [];

        public function setHook(string $tag, callable $callback): void {
            $this->tagHooks[$tag] = $callback;
        }

        /** @param array<string,string> $attributes */
        public function renderTag(string $tag, array $attributes, ?string $content = null): string {
            $frame = new class implements PPFrame {
            };
            return ($this->tagHooks[$tag])($content, $attributes, $this, $frame);
        }
    }
}

namespace MediaWiki\Html {
    /**
     * Html::element and Html::rawElement with MediaWiki 1.43's attribute rules for the
     * elements and attributes the extension emits.
     */
    final class Html {
        private const VOID_ELEMENTS = ['img' => true, 'source' => true];
        private const BOOLEAN_ATTRIBUTES = ['controls' => true, 'loop' => true, 'muted' => true];

        public static function element(
            string $element,
            array $attribs = [],
            string $contents = ''
        ): string {
            $escaped = strtr($contents, ['&' => '&amp;', '<' => '&lt;']);
            return self::rawElement($element, $attribs, $escaped);
        }

        public static function rawElement(
            string $element,
            array $attribs = [],
            string $contents = ''
        ): string {
            $start = '<' . $element . self::expandAttributes($attribs) . '>';
            return isset(self::VOID_ELEMENTS[$element]) ? $start : "$start$contents</$element>";
        }

        private static function expandAttributes(array $attribs): string {
            $html = '';
            foreach ($attribs as $name => $value) {
                if ($value === false || $value === null) {
                    continue;
                }
                if (isset(self::BOOLEAN_ATTRIBUTES[$name])) {
                    $html .= " $name=\"\"";
                    continue;
                }
                $encoded = htmlspecialchars((string)$value, ENT_QUOTES);
                $encoded = strtr($encoded, ["\n" => '&#10;', "\r" => '&#13;', "\t" => '&#9;']);
                $html .= " $name=\"$encoded\"";
            }
            return $html;
        }
    }
}

namespace {
    const NS_MAIN = 0;

    class Skin {
    }

    // MediaWiki 1.43 keeps these global aliases for older extensions.
    class_alias(\MediaWiki\Parser\Parser::class, 'Parser');
    class_alias(\MediaWiki\Parser\PPFrame::class, 'PPFrame');
}
