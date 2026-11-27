package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="

func imageRequest(t *testing.T, a *App, s *testSession, owner, relative string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest("GET", "https://app.test/api/images/"+owner+"/note?path="+relative, nil)
	if s != nil {
		r.AddCookie(s.cookie)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}
func TestUploadedImagesRemainPrivateAndEncrypted(t *testing.T) {
	a, path := setup(t)
	alice := loginTest(t, a, "alice", "user")
	bob := loginTest(t, a, "bob", "user")
	body := workspaceBody(0, "![图片](test.assets/image.png)")
	workspace := body["workspace"].(map[string]any)
	workspace["images"] = []any{map[string]any{"id": "image", "noteId": "note", "folder": "test.assets", "name": "image.png", "mime": "image/png", "base64": testPNG}}
	expectStatus(t, request(t, a, &alice, "PUT", "/api/workspace", body), 200)
	w := imageRequest(t, a, &alice, alice.user.ID, "test.assets/image.png")
	expectStatus(t, w, 200)
	raw, _ := base64.StdEncoding.DecodeString(testPNG)
	if !bytes.Equal(w.Body.Bytes(), raw) || w.Header().Get("Content-Type") != "image/png" {
		t.Fatal("image binary changed")
	}
	expectStatus(t, imageRequest(t, a, &alice, alice.user.ID, "&asset=image"), 200)
	expectStatus(t, imageRequest(t, a, nil, alice.user.ID, "test.assets/image.png"), 401)
	expectStatus(t, imageRequest(t, a, &bob, alice.user.ID, "test.assets/image.png"), 401)
	expectStatus(t, imageRequest(t, a, &bob, bob.user.ID, "test.assets/image.png"), 404)
	expectStatus(t, imageRequest(t, a, &alice, alice.user.ID, "../../secrets"), 404)
	dump, e := encryptedTestDump(a.store, path)
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(dump, []byte(testPNG)) {
		t.Fatal("plaintext image persisted")
	}
	body["revision"] = 1
	workspace["images"].([]any)[0].(map[string]any)["base64"] = base64.StdEncoding.EncodeToString([]byte("<svg onload='alert(1)'/>"))
	expectStatus(t, request(t, a, &alice, "PUT", "/api/workspace", body), 400)
	expectStatus(t, imageRequest(t, a, &alice, alice.user.ID, "test.assets/image.png"), 200)
}
func TestRepositoryImagesUseScopedCredentialsAndEncryptedCache(t *testing.T) {
	a, _ := setup(t)
	alice := loginTest(t, a, "alice", "user")
	bob := loginTest(t, a, "bob", "user")
	body := workspaceBody(0, "![image](test.assets/remote.png)")
	w := body["workspace"].(map[string]any)
	w["notes"].([]any)[0].(map[string]any)["folderId"] = "root"
	w["folders"] = []any{map[string]any{"id": "root", "name": "notes", "parentId": nil, "collapsed": false}}
	w["repositories"] = []any{map[string]any{"id": "repo", "owner": "demo", "repo": "notes", "rootFolderId": "root", "imageFiles": []any{map[string]any{"path": "test.assets/remote.png", "sha": strings.Repeat("a", 40)}}}}
	expectStatus(t, request(t, a, &alice, "PUT", "/api/workspace", body), 200)
	if e := a.store.db.Update(func(tx *recordTx) error {
		return a.store.put(tx, "credentials", alice.user.ID+":"+a.credentialKey("demo/notes"), map[string]string{"token": "private-alice-token"})
	}); e != nil {
		t.Fatal(e)
	}
	calls := 0
	a.client.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "api.github.com" || r.Header.Get("Authorization") != "Bearer private-alice-token" {
			t.Fatal("image credentials incorrectly scoped")
		}
		var payload any = map[string]string{"encoding": "base64", "content": testPNG}
		if strings.Contains(r.URL.Path, "/git/trees/") {
			payload = map[string]any{"truncated": false, "tree": []any{map[string]string{"path": "test.assets/remote.png", "sha": strings.Repeat("a", 40), "type": "blob", "mode": "100644"}}}
		}
		data, _ := json.Marshal(payload)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(data))}, nil
	})
	expectStatus(t, imageRequest(t, a, &alice, alice.user.ID, "test.assets/remote.png"), 200)
	expectStatus(t, imageRequest(t, a, &alice, alice.user.ID, "test.assets/remote.png"), 200)
	expectStatus(t, imageRequest(t, a, &bob, alice.user.ID, "test.assets/remote.png"), 401)
	if calls != 1 {
		t.Fatalf("expected cached blob, got %d calls", calls)
	}
	repository := w["repositories"].([]any)[0].(map[string]any)
	delete(repository, "imageFiles")
	repository["treeSha"] = strings.Repeat("b", 40)
	repository["allPaths"] = []string{"test.assets/remote.png"}
	body["revision"] = 1
	expectStatus(t, request(t, a, &alice, "PUT", "/api/workspace", body), 200)
	expectStatus(t, imageRequest(t, a, &alice, alice.user.ID, "test.assets/remote.png"), 200)
	expectStatus(t, imageRequest(t, a, &alice, alice.user.ID, "test.assets/remote.png"), 200)
	if calls != 2 {
		t.Fatalf("legacy tree should load once; got %d total requests", calls)
	}
}
