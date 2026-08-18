package com.zhishu.runtime;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import com.fasterxml.jackson.databind.ObjectMapper;

@Component
public class HttpRuntimeClient implements RuntimeClient {

    private final RestClient restClient;
    private final RuntimeProperties properties;
    private final ObjectMapper objectMapper;

    public HttpRuntimeClient(
            RestClient runtimeRestClient,
            RuntimeProperties properties,
            ObjectMapper objectMapper
    ) {
        this.restClient = runtimeRestClient;
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    @Override
    public RuntimeAccepted start(RuntimeStartCommand command) {
        requireToken();
        return postAccepted("/internal/runtime/v1/runs", command, RuntimeAccepted.class);
    }

    @Override
    public RuntimeCancelResult cancel(String runtimeRunId, RuntimeCancelCommand command) {
        requireToken();
        return postOk(
                "/internal/runtime/v1/runs/{runtimeRunId}/cancel",
                command,
                RuntimeCancelResult.class,
                runtimeRunId
        );
    }

    @Override
    public RuntimeApprovalDecisionResult decideApproval(
            String runtimeRunId,
            String runtimeApprovalId,
            RuntimeApprovalDecisionCommand command
    ) {
        requireToken();
        return postOk(
                "/internal/runtime/v1/runs/{runtimeRunId}/approvals/{runtimeApprovalId}/decision",
                command,
                RuntimeApprovalDecisionResult.class,
                runtimeRunId,
                runtimeApprovalId
        );
    }

    private void requireToken() {
        if (properties.token() == null || properties.token().isBlank()) {
            throw new RuntimeClientException("RUNTIME_AUTH_NOT_CONFIGURED", "ZS_RUNTIME_TOKEN is required");
        }
    }

    private <T> T postAccepted(String uri, Object body, Class<T> responseType, Object... uriVariables) {
        try {
            ResponseEntity<T> response = restClient.post()
                    .uri(uri, uriVariables)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + properties.token())
                    .body(body)
                    .retrieve()
                    .toEntity(responseType);

            if (response.getStatusCode() != HttpStatus.ACCEPTED || response.getBody() == null) {
                throw new RuntimeClientException(
                        "RUNTIME_START_FAILED",
                        "Node Runtime did not return 202 Accepted with a response body"
                );
            }
            return response.getBody();
        } catch (RuntimeClientException error) {
            throw error;
        } catch (HttpClientErrorException error) {
            throw translateUpstreamError("Unable to start Node Runtime", error);
        } catch (RestClientException error) {
            throw new RuntimeClientException("RUNTIME_UNAVAILABLE", "Unable to start Node Runtime", error);
        }
    }

    private <T> T postOk(String uri, Object body, Class<T> responseType, Object... uriVariables) {
        try {
            ResponseEntity<T> response = restClient.post()
                    .uri(uri, uriVariables)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + properties.token())
                    .body(body)
                    .retrieve()
                    .toEntity(responseType);
            if (response.getStatusCode() != HttpStatus.OK || response.getBody() == null) {
                throw new RuntimeClientException(
                        "RUNTIME_COMMAND_FAILED",
                        "Node Runtime did not return 200 OK with a response body"
                );
            }
            return response.getBody();
        } catch (RuntimeClientException error) {
            throw error;
        } catch (HttpClientErrorException error) {
            throw translateUpstreamError("Unable to call Node Runtime", error);
        } catch (RestClientException error) {
            throw new RuntimeClientException("RUNTIME_UNAVAILABLE", "Unable to call Node Runtime", error);
        }
    }

    /**
     * Preserves the Node Runtime's structured error (code/message) so the UI
     * shows the real rejection reason instead of a generic gateway failure.
     */
    private RuntimeClientException translateUpstreamError(
            String fallbackMessage,
            HttpClientErrorException error
    ) {
        try {
            byte[] responseBody = error.getResponseBodyAsByteArray();
            if (responseBody != null && responseBody.length > 0) {
                Map<?, ?> body = objectMapper.readValue(
                        new String(responseBody, StandardCharsets.UTF_8),
                        Map.class
                );
                Object code = body.get("code");
                Object message = body.get("message");
                if (code == null && body.get("error") instanceof Map<?, ?> nested) {
                    code = nested.get("code");
                    message = nested.get("message");
                }
                if (code instanceof String upstreamCode && message instanceof String upstreamMessage) {
                    return new RuntimeClientException(upstreamCode, upstreamMessage, error);
                }
            }
        } catch (Exception ignored) {
            // Fall through to the generic gateway error when the body is not JSON.
        }
        return new RuntimeClientException("RUNTIME_UNAVAILABLE", fallbackMessage, error);
    }
}
