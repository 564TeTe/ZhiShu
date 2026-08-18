package com.zhishu.event;

import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

@Validated
@RestController
@RequestMapping("/internal/control/v1")
public class RuntimeEventController {

    private final RuntimeEventIngestionService ingestion;

    public RuntimeEventController(RuntimeEventIngestionService ingestion) {
        this.ingestion = ingestion;
    }

    @PostMapping("/events:batch")
    public ResponseEntity<RuntimeEventIngestionResult> ingest(@Valid @RequestBody RuntimeEventBatch batch) {
        return ResponseEntity.accepted().body(ingestion.ingest(batch));
    }
}
