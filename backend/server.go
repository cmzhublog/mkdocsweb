package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	bolt "go.etcd.io/bbolt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const cookieName = "__Host-mkdocs-session"

var usernamePattern = regexp.MustCompile(`^[a-z0-9_-]{3,40}$`)

type Config struct {
	Origin       string
	StaticDir    string
	TrustedProxy netip.Prefix
}
type attempt struct {
	count int
	until time.Time
}
type App struct {
	store    *Store
	cfg      Config
	client   *http.Client
	rateMu   sync.Mutex
	attempts map[string]attempt
	dummy    User
}

func newApp(s *Store, c Config) *App {
	salt := "AAAAAAAAAAAAAAAAAAAAAA=="
	a := &App{store: s, cfg: c, attempts: map[string]attempt{}, client: &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	a.dummy = User{Salt: salt, Hash: passwordHash("dummy-password-never-valid", make([]byte, 16))}
	return a
}
func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		fail(w, 415, "需要 application/json")
		return false
	}
	limit := int64(64 << 20)
	if strings.HasPrefix(r.URL.Path, "/api/auth/") || strings.HasPrefix(r.URL.Path, "/api/admin/") {
		limit = 16 << 10
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		fail(w, 400, "请求格式无效或超过接口大小限制")
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		fail(w, 400, "请求格式无效")
		return false
	}
	return true
}
func (a *App) secure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	host, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		return false
	}
	ip, e := netip.ParseAddr(host)
	return e == nil && a.cfg.TrustedProxy.IsValid() && a.cfg.TrustedProxy.Contains(ip.Unmap()) && r.Header.Get("X-Forwarded-Proto") == "https"
}
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
	if !a.secure(r) {
		fail(w, 426, "请通过 HTTPS 访问服务")
		return
	}
	w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	origin, _ := url.Parse(a.cfg.Origin)
	if r.Host != origin.Host {
		fail(w, 403, "访问地址不匹配 APP_ORIGIN")
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		a.static(w, r)
		return
	}
	if r.Header.Get("Origin") != "" && r.Header.Get("Origin") != a.cfg.Origin {
		fail(w, 403, "来源不允许")
		return
	}
	mutation := r.Method != "GET" && r.Method != "HEAD"
	if mutation && r.Header.Get("Origin") != a.cfg.Origin {
		fail(w, 403, "需要同源请求")
		return
	}
	if r.URL.Path == "/api/auth/login" && r.Method == "POST" {
		a.login(w, r)
		return
	}
	u, session, key, e := a.authenticate(r)
	if e != nil {
		fail(w, 401, "请登录或重新登录")
		return
	}
	if r.URL.Path != "/api/auth/session" && r.Header.Get("X-Session-User") != u.ID {
		fail(w, 401, "账号已切换，请重新加载")
		return
	}
	if mutation && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(session.CSRF)) != 1 {
		fail(w, 403, "请求校验失败，请刷新页面")
		return
	}
	switch {
	case r.URL.Path == "/api/auth/session" && r.Method == "GET":
		reply(w, 200, map[string]any{"user": publicUser(u), "csrf": session.CSRF})
	case r.URL.Path == "/api/auth/logout" && r.Method == "POST":
		if e := a.store.db.Update(func(tx *bolt.Tx) error { return tx.Bucket([]byte("sessions")).Delete([]byte(key)) }); e != nil {
			fail(w, 500, "退出失败")
			return
		}
		http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
		reply(w, 200, map[string]bool{"ok": true})
	case r.URL.Path == "/api/auth/password" && r.Method == "POST":
		a.changePassword(w, r, u)
	case r.URL.Path == "/api/workspace":
		a.workspace(w, r, u)
	case strings.HasPrefix(r.URL.Path, "/api/admin/"):
		if u.Role != "admin" {
			fail(w, 403, "仅管理员可操作")
			return
		}
		a.admin(w, r, u)
	case r.URL.Path == "/api/git/request" && r.Method == "POST":
		a.gitRequest(w, r, u)
	case r.URL.Path == "/api/git/credential" && r.Method == "DELETE":
		a.deleteCredential(w, r, u)
	default:
		fail(w, 404, "接口不存在")
	}
}
func (a *App) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		fail(w, 405, "请求方法不支持")
		return
	}
	path := r.URL.Path
	if path != "/" && path != "/favicon.svg" && !strings.HasPrefix(path, "/assets/") {
		fail(w, 404, "页面不存在")
		return
	}
	if strings.Contains(path, "..") || strings.Contains(path, "\\") {
		fail(w, 404, "页面不存在")
		return
	}
	if path == "/" {
		path = "/index.html"
	}
	http.ServeFile(w, r, filepath.Join(a.cfg.StaticDir, filepath.FromSlash(path)))
}
func (a *App) authenticate(r *http.Request) (u User, s Session, key string, err error) {
	c, e := r.Cookie(cookieName)
	if e != nil || len(c.Value) != 64 {
		return u, s, "", os.ErrNotExist
	}
	key = sessionKey(c.Value)
	err = a.store.db.Update(func(tx *bolt.Tx) error {
		if e := a.store.get(tx, "sessions", key, &s); e != nil {
			return e
		}
		now := time.Now().Unix()
		if now > s.Expires || now-s.LastSeen > 1800 {
			tx.Bucket([]byte("sessions")).Delete([]byte(key))
			return os.ErrNotExist
		}
		if e := a.store.get(tx, "users", s.UserID, &u); e != nil {
			return e
		}
		if u.Disabled {
			return os.ErrNotExist
		}
		if now-s.LastSeen > 60 {
			s.LastSeen = now
			return a.store.put(tx, "sessions", key, s)
		}
		return nil
	})
	return
}
func (a *App) allowLogin(r *http.Request) bool {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	a.rateMu.Lock()
	defer a.rateMu.Unlock()
	now := time.Now()
	for k, v := range a.attempts {
		if now.After(v.until) {
			delete(a.attempts, k)
		}
	}
	v := a.attempts[host]
	if v.count >= 10 {
		return false
	}
	v.count++
	if v.until.IsZero() {
		v.until = now.Add(10 * time.Minute)
	}
	if len(a.attempts) >= 10000 && v.count == 1 {
		return false
	}
	a.attempts[host] = v
	return true
}
func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.allowLogin(r) {
		w.Header().Set("Retry-After", "600")
		fail(w, 429, "登录尝试过多，请稍后重试")
		return
	}
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &input) {
		return
	}
	if len(input.Password) > 128 || len(input.Username) > 40 {
		fail(w, 401, "账号或密码错误")
		return
	}
	u := a.dummy
	found := false
	e := a.store.db.View(func(tx *bolt.Tx) error {
		users, e := a.store.users(tx)
		if e != nil {
			return e
		}
		for _, v := range users {
			if v.Username == strings.ToLower(strings.TrimSpace(input.Username)) {
				u = v
				found = true
			}
		}
		return nil
	})
	if e != nil {
		fail(w, 500, "无法读取账号")
		return
	}
	valid := verifyPassword(u, input.Password)
	if !valid || !found || u.Disabled {
		fail(w, 401, "账号或密码错误")
		return
	}
	raw := randomID()
	s := Session{UserID: u.ID, CSRF: randomID(), Expires: time.Now().Add(8 * time.Hour).Unix(), LastSeen: time.Now().Unix()}
	e = a.store.db.Update(func(tx *bolt.Tx) error {
		var current User
		if e := a.store.get(tx, "users", u.ID, &current); e != nil {
			return e
		}
		if current.Disabled || current.Hash != u.Hash {
			return errors.New("account changed")
		}
		b := tx.Bucket([]byte("sessions"))
		now := time.Now().Unix()
		if e := a.store.deleteSessions(tx, func(old Session) bool { return now > old.Expires || now-old.LastSeen > 1800 }); e != nil {
			return e
		}
		if old, e := r.Cookie(cookieName); e == nil {
			if e := b.Delete([]byte(sessionKey(old.Value))); e != nil {
				return e
			}
		}
		return a.store.put(tx, "sessions", sessionKey(raw), s)
	})
	if e != nil {
		fail(w, 500, "无法创建会话")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: raw, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 8 * 3600})
	reply(w, 200, map[string]any{"user": publicUser(u), "csrf": s.CSRF})
}
func (a *App) changePassword(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		CurrentPassword string `json:"currentPassword"`
		Password        string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.CurrentPassword) > 128 || !verifyPassword(u, in.CurrentPassword) {
		fail(w, 403, "当前密码错误")
		return
	}
	oldHash := u.Hash
	if e := setPassword(&u, in.Password); e != nil {
		fail(w, 400, e.Error())
		return
	}
	e := a.store.db.Update(func(tx *bolt.Tx) error {
		var current User
		if e := a.store.get(tx, "users", u.ID, &current); e != nil {
			return e
		}
		if current.Hash != oldHash || current.Disabled {
			return errConflict
		}
		current.Salt = u.Salt
		current.Hash = u.Hash
		if e := a.store.put(tx, "users", u.ID, current); e != nil {
			return e
		}
		return a.store.revoke(tx, u.ID)
	})
	if e != nil {
		fail(w, 409, "账号已变更，请重新登录")
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}
func (a *App) workspace(w http.ResponseWriter, r *http.Request, u User) {
	if r.Method == "GET" {
		d := Document{Workspace: json.RawMessage("null")}
		e := a.store.db.View(func(tx *bolt.Tx) error { return a.store.get(tx, "workspaces", u.ID, &d) })
		if e != nil && !errors.Is(e, os.ErrNotExist) {
			fail(w, 500, "文档解密失败")
			return
		}
		reply(w, 200, d)
		return
	}
	if r.Method != "PUT" {
		fail(w, 405, "请求方法不支持")
		return
	}
	var in Document
	if !decode(w, r, &in) {
		return
	}
	if !validWorkspace(in.Workspace) {
		fail(w, 400, "文档格式无效，未覆盖已保存内容")
		return
	}
	e := a.store.db.Update(func(tx *bolt.Tx) error {
		var old Document
		if e := a.store.get(tx, "workspaces", u.ID, &old); e != nil && !errors.Is(e, os.ErrNotExist) {
			return e
		}
		if old.Revision != in.Revision {
			return errConflict
		}
		in.Revision++
		return a.store.put(tx, "workspaces", u.ID, in)
	})
	if errors.Is(e, errConflict) {
		fail(w, 409, "其他窗口已保存新版本，请先导出当前内容再刷新")
		return
	}
	if e != nil {
		fail(w, 500, "保存失败")
		return
	}
	reply(w, 200, map[string]int64{"revision": in.Revision})
}
func (a *App) admin(w http.ResponseWriter, r *http.Request, actor User) {
	if r.URL.Path == "/api/admin/users" {
		switch r.Method {
		case "GET":
			var users []User
			e := a.store.db.View(func(tx *bolt.Tx) error { var e error; users, e = a.store.users(tx); return e })
			if e != nil {
				fail(w, 500, "读取失败")
				return
			}
			for i := range users {
				users[i] = publicUser(users[i])
			}
			reply(w, 200, users)
		case "POST":
			var in struct {
				Username string `json:"username"`
				Password string `json:"password"`
				Role     string `json:"role"`
			}
			if !decode(w, r, &in) {
				return
			}
			u, e := a.store.createUser(in.Username, in.Password, in.Role)
			if e != nil {
				fail(w, 400, "创建失败，请检查用户名是否重复及密码长度")
				return
			}
			reply(w, 201, u)
		default:
			fail(w, 405, "请求方法不支持")
		}
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	if id == r.URL.Path || strings.Contains(id, "/") || r.Method != "PATCH" {
		fail(w, 404, "接口不存在")
		return
	}
	var in struct {
		Role     *string `json:"role"`
		Disabled *bool   `json:"disabled"`
		Password *string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Role != nil && *in.Role != "admin" && *in.Role != "user" {
		fail(w, 400, "角色无效")
		return
	}
	var password User
	if in.Password != nil {
		if e := setPassword(&password, *in.Password); e != nil {
			fail(w, 400, e.Error())
			return
		}
	}
	e := a.store.db.Update(func(tx *bolt.Tx) error {
		var currentActor User
		if e := a.store.get(tx, "users", actor.ID, &currentActor); e != nil {
			return e
		}
		if currentActor.Role != "admin" || currentActor.Disabled {
			return errors.New("forbidden")
		}
		var u User
		if e := a.store.get(tx, "users", id, &u); e != nil {
			return e
		}
		if in.Role != nil {
			u.Role = *in.Role
		}
		if in.Disabled != nil {
			u.Disabled = *in.Disabled
		}
		if in.Password != nil {
			u.Salt = password.Salt
			u.Hash = password.Hash
		}
		users, e := a.store.users(tx)
		if e != nil {
			return e
		}
		admins := 0
		for _, v := range users {
			if v.ID == u.ID {
				v = u
			}
			if v.Role == "admin" && !v.Disabled {
				admins++
			}
		}
		if admins == 0 {
			return errors.New("last administrator")
		}
		if e := a.store.put(tx, "users", id, u); e != nil {
			return e
		}
		return a.store.revoke(tx, id)
	})
	if e != nil {
		fail(w, 400, "操作失败：用户不存在或不能停用、降级最后一名管理员")
		return
	}
	reply(w, 200, map[string]bool{"ok": true})
}
