import { getConnectPath, parseProtoFile } from "../src/parser";

describe("Proto Parser", () => {
  describe("parseProtoFile", () => {
    it("should extract package name correctly", () => {
      const proto = `
        syntax = "proto3";
        package users.v1;

        service UserService {}
      `;

      const services = parseProtoFile(proto);
      expect(services).toHaveLength(0); // No methods with HTTP annotations
    });

    it("should parse service with GET method", () => {
      const proto = `
        syntax = "proto3";
        package users.v1;

        service UserService {
          rpc GetUser(GetUserRequest) returns (GetUserResponse) {
            option (google.api.http) = {
              get: "/v1/users/{user_id}"
            };
          };
        }
      `;

      const services = parseProtoFile(proto);

      expect(services).toHaveLength(1);
      expect(services[0].packageName).toBe("users.v1");
      expect(services[0].serviceName).toBe("UserService");
      expect(services[0].fullName).toBe("users.v1.UserService");
      expect(services[0].methods).toHaveLength(1);

      const method = services[0].methods[0];
      expect(method.name).toBe("GetUser");
      expect(method.httpMethod).toBe("GET");
      expect(method.httpPath).toBe("/v1/users/{user_id}");
    });

    it("should parse service with POST method and body", () => {
      const proto = `
        syntax = "proto3";
        package users.v1;

        service UserService {
          rpc CreateUser(CreateUserRequest) returns (CreateUserResponse) {
            option (google.api.http) = {
              post: "/v1/users"
              body: "*"
            };
          };
        }
      `;

      const services = parseProtoFile(proto);

      expect(services).toHaveLength(1);
      const method = services[0].methods[0];
      expect(method.name).toBe("CreateUser");
      expect(method.httpMethod).toBe("POST");
      expect(method.httpPath).toBe("/v1/users");
      expect(method.body).toBe("*");
    });

    it("should parse all HTTP methods", () => {
      const proto = `
        syntax = "proto3";
        package api.v1;

        service TestService {
          rpc Get(Req) returns (Res) {
            option (google.api.http) = { get: "/get" };
          };
          rpc Post(Req) returns (Res) {
            option (google.api.http) = { post: "/post" };
          };
          rpc Put(Req) returns (Res) {
            option (google.api.http) = { put: "/put" };
          };
          rpc Patch(Req) returns (Res) {
            option (google.api.http) = { patch: "/patch" };
          };
          rpc Delete(Req) returns (Res) {
            option (google.api.http) = { delete: "/delete" };
          };
        }
      `;

      const services = parseProtoFile(proto);

      expect(services).toHaveLength(1);
      expect(services[0].methods).toHaveLength(5);

      const methods = services[0].methods;
      expect(methods[0].httpMethod).toBe("GET");
      expect(methods[1].httpMethod).toBe("POST");
      expect(methods[2].httpMethod).toBe("PUT");
      expect(methods[3].httpMethod).toBe("PATCH");
      expect(methods[4].httpMethod).toBe("DELETE");
    });

    it("should handle multiple services", () => {
      const proto = `
        syntax = "proto3";
        package api.v1;

        service UserService {
          rpc GetUser(Req) returns (Res) {
            option (google.api.http) = { get: "/users/{id}" };
          };
        }

        service OrderService {
          rpc GetOrder(Req) returns (Res) {
            option (google.api.http) = { get: "/orders/{id}" };
          };
        }
      `;

      const services = parseProtoFile(proto);

      expect(services).toHaveLength(2);
      expect(services[0].serviceName).toBe("UserService");
      expect(services[1].serviceName).toBe("OrderService");
    });

    it("should handle complex nested path variables", () => {
      const proto = `
        syntax = "proto3";
        package api.v1;

        service BlogService {
          rpc GetComment(Req) returns (Res) {
            option (google.api.http) = {
              get: "/v1/users/{user_id}/posts/{post_id}/comments/{comment_id}"
            };
          };
        }
      `;

      const services = parseProtoFile(proto);

      expect(services[0].methods[0].httpPath).toBe(
        "/v1/users/{user_id}/posts/{post_id}/comments/{comment_id}",
      );
    });

    it("should skip methods without google.api.http", () => {
      const proto = `
        syntax = "proto3";
        package api.v1;

        service MixedService {
          rpc WithHttp(Req) returns (Res) {
            option (google.api.http) = { get: "/with-http" };
          };

          rpc WithoutHttp(Req) returns (Res) {
            // No HTTP annotation
          };
        }
      `;

      const services = parseProtoFile(proto);

      expect(services).toHaveLength(1);
      expect(services[0].methods).toHaveLength(1);
      expect(services[0].methods[0].name).toBe("WithHttp");
    });

    it("should parse methods with stream keyword", () => {
      const proto = `
        syntax = "proto3";
        package api.v1;

        service ChatService {
          rpc Chat(stream ChatRequest) returns (stream ChatResponse) {
            option (google.api.http) = { post: "/chat" };
          };

          rpc Subscribe(SubscriptionRequest) returns (stream Event) {
            option (google.api.http) = { get: "/events" };
          };
        }
      `;

      const services = parseProtoFile(proto);

      expect(services).toHaveLength(1);
      expect(services[0].methods).toHaveLength(2);
      expect(services[0].methods[0].name).toBe("Chat");
      expect(services[0].methods[0].inputType).toBe("ChatRequest");
      expect(services[0].methods[0].outputType).toBe("ChatResponse");
      expect(services[0].methods[1].httpMethod).toBe("GET");
    });

    it("should ignore braces inside comments", () => {
      const proto = `
        syntax = "proto3";
        package api.v1;

        // Service with a { brace in a line comment
        /* block comment with } unmatched brace */
        service CommentedService {
          // method { with } braces
          rpc Hello(Req) returns (Res) {
            /* annotation { } */
            option (google.api.http) = { get: "/hello" };
          };
        }
      `;

      const services = parseProtoFile(proto);

      expect(services).toHaveLength(1);
      expect(services[0].serviceName).toBe("CommentedService");
      expect(services[0].methods).toHaveLength(1);
      expect(services[0].methods[0].httpPath).toBe("/hello");
    });

    it("should use primary binding over additional_bindings", () => {
      const proto = `
        syntax = "proto3";
        package api.v1;

        service MultiService {
          rpc GetThing(Req) returns (Res) {
            option (google.api.http) = {
              get: "/v1/things/{thing_id}"
              additional_bindings {
                post: "/v1/things"
                body: "*"
              }
            };
          };
        }
      `;

      const services = parseProtoFile(proto);

      expect(services).toHaveLength(1);
      const method = services[0].methods[0];
      expect(method.httpMethod).toBe("GET");
      expect(method.httpPath).toBe("/v1/things/{thing_id}");
      // additional_bindings body should NOT leak into the primary binding
      expect(method.body).toBeUndefined();
    });
  });

  describe("getConnectPath", () => {
    it("should generate correct Connect path", () => {
      const service = {
        packageName: "users.v1",
        serviceName: "UserService",
        fullName: "users.v1.UserService",
        methods: [],
      };

      const method = {
        name: "GetUser",
        inputType: "GetUserRequest",
        outputType: "GetUserResponse",
        httpMethod: "GET" as const,
        httpPath: "/v1/users/{user_id}",
      };

      const path = getConnectPath(service, method);
      expect(path).toBe("/users.v1.UserService/GetUser");
    });
  });
});
