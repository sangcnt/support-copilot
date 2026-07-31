<?php

namespace App\Http\Controllers;

use App\Http\Resources\DocumentResource;
use App\Models\Document;

class PublicDocumentController extends Controller
{
    public function show(Document $document): DocumentResource
    {
        return new DocumentResource($document);
    }
}
