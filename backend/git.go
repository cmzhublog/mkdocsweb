package main

import (
	"bytes"
	"encoding/json"

	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
)

var repoPath = regexp.MustCompile(`^/repos/([A-Za-z0-9_-]+)/([A-Za-z0-9_.-]+)(/git/.*)?$`)
var shaPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
var readGitPath = regexp.MustCompile(`^/git/(commits|trees|blobs)/[0-9a-f]{40}$`)

func validGitPath(path, method string) (string, bool) {
	u, e := url.ParseRequestURI(path)
	if e != nil || u.IsAbs() || u.Host != "" || u.Fragment != "" {
		return "", false
	}
	m := repoPath.FindStringSubmatch(u.EscapedPath())
	if m == nil || m[2] == "." || m[2] == ".." {
		return "", false
	}
	tail := m[3]
	query := u.RawQuery
	if query != "" && !(strings.HasPrefix(tail, "/git/trees/") && query == "recursive=1" && method == "GET") {
		return "", false
	}
	valid := false
	switch method {
	case "GET":
		valid = tail == "" || readGitPath.MatchString(tail) || (strings.HasPrefix(tail, "/git/ref/heads/") && len(tail) > len("/git/ref/heads/"))
	case "POST":
		valid = tail == "/git/trees" || tail == "/git/commits"
	case "PATCH":
		valid = strings.HasPrefix(tail, "/git/refs/heads/") && len(tail) > len("/git/refs/heads/")
	}
	if strings.Contains(tail, "..") || strings.Contains(tail, "\\") || strings.ContainsAny(tail, "\r\n") {
		valid = false
	}
	return strings.ToLower(m[1] + "/" + m[2]), valid
}
func (a *App) gitRequest(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		Path   string          `json:"path"`
		Method string          `json:"method"`
		Body   json.RawMessage `json:"body,omitempty"`
		Token  string          `json:"token,omitempty"`
	}
	if !decode(w, r, &in) {
		return
	}
	repository, valid := validGitPath(in.Path, in.Method)
	if !valid || len(in.Token) > 4096 || strings.ContainsAny(in.Token, "\r\n") {
		fail(w, 400, "GitHub 请求路径无效")
		return
	}
	if in.Method == "PATCH" {
		var body struct {
			SHA   string `json:"sha"`
			Force *bool  `json:"force"`
		}
		d := json.NewDecoder(bytes.NewReader(in.Body))
		d.DisallowUnknownFields()
		if d.Decode(&body) != nil || body.Force == nil || *body.Force || !shaPattern.MatchString(body.SHA) {
			fail(w, 400, "禁止强制推送")
			return
		}
	}
	// The repository name is part of encrypted contents; the DB key is a keyed digest.
	key := u.ID + ":" + a.credentialKey(repository)
	token := in.Token
	e := a.store.db.Update(func(tx *recordTx) error {
		var current User
		if e := a.store.get(tx, "users", u.ID, &current); e != nil {
			return e
		}
		if current.Disabled {
			return os.ErrPermission
		}
		if token != "" {
			return a.store.put(tx, "credentials", key, map[string]string{"repository": repository, "token": token})
		}
		var saved map[string]string
		e := a.store.get(tx, "credentials", key, &saved)
		if e == nil {
			token = saved["token"]
		}
		if e == os.ErrNotExist {
			return nil
		}
		return e
	})
	if e != nil {
		fail(w, 500, "无法读取或保存 Git 连接")
		return
	}
	if in.Method != "GET" && token == "" {
		fail(w, 400, "请先填写具有 Contents 读写权限的 GitHub 令牌")
		return
	}
	req, e := http.NewRequestWithContext(r.Context(), in.Method, "https://api.github.com"+in.Path, bytes.NewReader(in.Body))
	if e != nil {
		fail(w, 400, "GitHub 请求无效")
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "mkdocsweb")
	if len(in.Body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	response, e := a.client.Do(req)
	if e != nil {
		fail(w, 502, "无法连接 GitHub；若刚提交，请先核实远端结果")
		return
	}
	defer response.Body.Close()
	raw, e := io.ReadAll(io.LimitReader(response.Body, (64<<20)+1))
	if e != nil || len(raw) > 64<<20 {
		fail(w, 502, "GitHub 响应过大或读取失败")
		return
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		fail(w, 502, "GitHub 重定向已拒绝")
		return
	}
	if !json.Valid(raw) {
		fail(w, 502, "GitHub 返回格式无效")
		return
	}
	reply(w, 200, map[string]any{"status": response.StatusCode, "data": json.RawMessage(raw)})
}
func (a *App) deleteCredential(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		Repository string `json:"repository"`
	}
	if !decode(w, r, &in) {
		return
	}
	key := u.ID + ":" + a.credentialKey(strings.ToLower(in.Repository))
	e := a.store.db.Update(func(tx *recordTx) error { return tx.Delete("credentials", key) })
	if e != nil {
		fail(w, 500, "删除失败")
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}
