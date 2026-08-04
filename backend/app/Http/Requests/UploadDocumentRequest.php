<?php

namespace App\Http\Requests;

use App\Rules\PdfDocument;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\File;

class UploadDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'file' => [
                'bail',
                'required',
                File::types(['pdf'])->max((int) config('demo.documents.max_kilobytes')),
                new PdfDocument,
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'Choose a PDF to upload.',
            'file.mimes' => 'Only PDF documents are supported.',
            'file.max' => 'The PDF must not exceed 10 MB.',
        ];
    }
}
