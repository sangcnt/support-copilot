<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Http\UploadedFile;
use Illuminate\Translation\PotentiallyTranslatedString;

class PdfDocument implements ValidationRule
{
    /**
     * @param  Closure(string, ?string=): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! $value instanceof UploadedFile || ! $value->isValid()) {
            $fail('The uploaded PDF is invalid.');

            return;
        }

        $path = $value->getRealPath();

        if ($path === false) {
            $fail('The uploaded PDF is unavailable.');

            return;
        }

        $handle = fopen($path, 'rb');
        $signature = $handle === false ? false : fread($handle, 5);

        if (is_resource($handle)) {
            fclose($handle);
        }

        if ($value->getMimeType() !== 'application/pdf' || $signature !== '%PDF-') {
            $fail('Only valid PDF documents are supported.');
        }
    }
}
