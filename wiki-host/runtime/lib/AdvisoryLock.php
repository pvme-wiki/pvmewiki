<?php
declare(strict_types=1);

/**
 * PostgreSQL advisory locks that keep two starting containers from bootstrapping or
 * publishing at the same time. Each is the key pair (CLASS_KEY, case value).
 */
enum AdvisoryLock: int {
    public const CLASS_KEY = 734021;

    case Bootstrap = 381;
    case VisualGuides = 382;
}
