/*global define*/
define([
        '../Core/combine',
        '../Core/defined',
        '../Core/defaultValue',
        '../Core/destroyObject',
        '../Core/DeveloperError',
        '../Core/RuntimeError',
        '../Core/loadArrayBuffer',
        '../Core/loadText',
        '../Core/loadImage',
        '../Core/Queue',
        '../Core/Cartesian2',
        '../Core/Cartesian3',
        '../Core/Cartesian4',
        '../Core/Quaternion',
        '../Core/Matrix2',
        '../Core/Matrix3',
        '../Core/Matrix4',
        '../Core/BoundingSphere',
        '../Core/PrimitiveType',
        '../Core/IndexDatatype',
        '../Core/Math',
        '../Core/Event',
        '../Core/JulianDate',
        '../Renderer/TextureWrap',
        '../Renderer/TextureMinificationFilter',
        '../Renderer/BufferUsage',
        '../Renderer/BlendingState',
        '../Renderer/DrawCommand',
        '../Renderer/Pass',
        '../Renderer/createShaderSource',
        './ModelTypes',
        './ModelCache',
        './ModelAnimationCollection',
        './ModelNode',
        './SceneMode',
        './gltfDefaults'
    ], function(
        combine,
        defined,
        defaultValue,
        destroyObject,
        DeveloperError,
        RuntimeError,
        loadArrayBuffer,
        loadText,
        loadImage,
        Queue,
        Cartesian2,
        Cartesian3,
        Cartesian4,
        Quaternion,
        Matrix2,
        Matrix3,
        Matrix4,
        BoundingSphere,
        PrimitiveType,
        IndexDatatype,
        CesiumMath,
        Event,
        JulianDate,
        TextureWrap,
        TextureMinificationFilter,
        BufferUsage,
        BlendingState,
        DrawCommand,
        Pass,
        createShaderSource,
        ModelTypes,
        ModelCache,
        ModelAnimationCollection,
        ModelNode,
        SceneMode,
        gltfDefaults) {
    "use strict";

    var ModelState = {
        NEEDS_LOAD : 0,
        LOADING : 1,
        LOADED : 2
    };

    function LoadResources() {
        this.buffersToCreate = new Queue();
        this.buffers = {};
        this.pendingBufferLoads = 0;

        this.programsToCreate = new Queue();
        this.shaders = {};
        this.pendingShaderLoads = 0;

        this.texturesToCreate = new Queue();
        this.pendingTextureLoads = 0;

        this.createSamplers = true;
        this.createSkins = true;
        this.createRuntimeAnimations = true;
        this.createVertexArrays = true;
        this.createRenderStates = true;
        this.createUniformMaps = true;
        this.createRuntimeNodes = true;

        this.skinnedNodesNames = [];
    }

    LoadResources.prototype.finishedPendingLoads = function() {
        return ((this.pendingBufferLoads === 0) &&
                (this.pendingShaderLoads === 0) &&
                (this.pendingTextureLoads === 0));
    };

    LoadResources.prototype.finishedResourceCreation = function() {
        return ((this.buffersToCreate.length === 0) &&
                (this.programsToCreate.length === 0) &&
                (this.texturesToCreate.length === 0));
    };

    LoadResources.prototype.finishedBuffersCreation = function() {
        return ((this.pendingBufferLoads === 0) && (this.buffersToCreate.length === 0));
    };

    LoadResources.prototype.finishedProgramCreation = function() {
        return ((this.pendingShaderLoads === 0) && (this.programsToCreate.length === 0));
    };

    LoadResources.prototype.finishedTextureCreation = function() {
        return ((this.pendingTextureLoads === 0) && (this.texturesToCreate.length === 0));
    };

    /**
     * A 3D model based on glTF, the runtime asset format for WebGL, OpenGL ES, and OpenGL.
     * <p>
     * Cesium includes support for geometry and materials, glTF animations, and glTF skinning.
     * In addition, individual glTF nodes are pickable with {@link Scene#pick} and animatable
     * with {@link Model#getNode}.  glTF cameras and lights are not currently supported.
     * </p>
     * <p>
     * An external glTF asset is created with {@link Model#fromGltf}.  glTF JSON can also be
     * created at runtime and passed to this constructor function.  In either case, the
     * {@link Model#readyToRender} event is fired when the model is ready to render, i.e.,
     * when the external binary, image, and shader files are downloaded and the WebGL
     * resources are created.
     * </p>
     *
     * @alias Model
     * @constructor
     *
     * @param {Object} [options.gltf=undefined] The object for the glTF JSON.
     * @param {String} [options.basePath=''] The base path that paths in the glTF JSON are relative to.
     * @param {Boolean} [options.show=true] Determines if the model primitive will be shown.
     * @param {Matrix4} [options.modelMatrix=Matrix4.IDENTITY] The 4x4 transformation matrix that transforms the model from model to world coordinates.
     * @param {Number} [options.scale=1.0] A uniform scale applied to this model.
     * @param {Object} [options.allowPicking=true] When <code>true</code>, each glTF mesh and primitive is pickable with {@link Scene#pick}.
     * @param {Event} [options.readyToRender=new Event()] The event fired when this model is ready to render.
     * @param {Boolean} [options.debugShowBoundingVolume=false] For debugging only. Draws the bounding sphere for each {@link DrawCommand} in the model.
     * @param {Boolean} [options.debugWireframe=false] For debugging only. Draws the model in wireframe.
     *
     * @see Model#fromGltf
     * @see Model#readyToRender
     */
    var Model = function(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        /**
         * The object for the glTF JSON, including properties with default values omitted
         * from the JSON provided to this model.
         *
         * @type {Object}
         *
         * @default undefined
         *
         * @readonly
         */
        this.gltf = gltfDefaults(options.gltf);

        /**
         * The base path that paths in the glTF JSON are relative to.  The base
         * path is the same path as the path containing the .json file
         * minus the .json file, when binary, image, and shader files are
         * in the same directory as the .json.  When this is <code>''</code>,
         * the app's base path is used.
         *
         * @type {String}
         *
         * @default ''
         *
         * @readonly
         */
        this.basePath = defaultValue(options.basePath, '');

        /**
         * Determines if the model primitive will be shown.
         *
         * @type {Boolean}
         *
         * @default true
         */
        this.show = defaultValue(options.show, true);

        /**
         * The 4x4 transformation matrix that transforms the model from model to world coordinates.
         * When this is the identity matrix, the model is drawn in world coordinates, i.e., Earth's WGS84 coordinates.
         * Local reference frames can be used by providing a different transformation matrix, like that returned
         * by {@link Transforms.eastNorthUpToFixedFrame}.
         *
         * @type {Matrix4}
         *
         * @default {@link Matrix4.IDENTITY}
         *
         * @example
         * var origin = ellipsoid.cartographicToCartesian(
         *   Cartographic.fromDegrees(-95.0, 40.0, 200000.0));
         * m.modelMatrix = Transforms.eastNorthUpToFixedFrame(origin);
         *
         * @see Transforms.eastNorthUpToFixedFrame
         */
        this.modelMatrix = Matrix4.clone(defaultValue(options.modelMatrix, Matrix4.IDENTITY));
        this._modelMatrix = Matrix4.clone(this.modelMatrix);

        /**
         * A uniform scale applied to this model before the {@link Model#modelMatrix}.
         * Values greater than <code>1.0</code> increase the size of the model; values
         * less than <code>1.0</code> decrease.
         *
         * @type {Number}
         *
         * @default 1.0
         */
        this.scale = defaultValue(options.scale, 1.0);
        this._scale = this.scale;

        /**
         * User-defined object returned when the model is picked.
         *
         * @type Object
         *
         * @default undefined
         *
         * @see Scene#pick
         */
        this.id = options.id;
        this._id = options.id;

        /**
         * When <code>true</code>, each glTF mesh and primitive is pickable with {@link Scene#pick}.  When <code>false</code>, GPU memory is saved.         *
         *
         * @type {Boolean}
         *
         * @default true
         *
         * @readonly
         */
        this.allowPicking = defaultValue(options.allowPicking, true);

        /**
         * The event fired when this model is ready to render, i.e., when the external binary, image,
         * and shader files were downloaded and the WebGL resources were created.
         * <p>
         * This is event is fired at the end of the frame before the first frame the model is rendered in.
         * </p>
         *
         * @type {Event}
         * @default undefined
         *
         * @example
         * // Play all animations at half-speed when the model is ready to render
         * model.readyToRender.addEventListener(function(model) {
         *   model.activeAnimations.addAll({
         *     speedup : 0.5
         *   });
         * });
         */
        this.readyToRender = defaultValue(options.readyToRender, new Event());

// TODO: will change with animation
// TODO: only load external files if within bounding sphere
// TODO: cull whole model, not commands?  Good for our use-cases, but not buildings, etc.
        /**
         * DOC_TBA
         */
        this.worldBoundingSphere = new BoundingSphere();

        /**
         * The currently playing glTF animations.
         *
         * @type {ModelAnimationCollection}
         */
        this.activeAnimations = new ModelAnimationCollection(this);

        /**
         * This property is for debugging only; it is not for production use nor is it optimized.
         * <p>
         * Draws the bounding sphere for each {@link DrawCommand} in the model.  A glTF primitive corresponds
         * to one {@link DrawCommand}.  A glTF mesh has an array of primitives, often of length one.
         * </p>
         *
         * @type {Boolean}
         *
         * @default false
         */
        this.debugShowBoundingVolume = defaultValue(options.debugShowBoundingVolume, false);

        /**
         * This property is for debugging only; it is not for production use nor is it optimized.
         * <p>
         * Draws the model in wireframe.
         * </p>
         *
         * @type {Boolean}
         *
         * @default false
         */
        this.debugWireframe = defaultValue(options.debugWireframe, false);
        this._debugWireframe = false;

        this._computedModelMatrix = new Matrix4(); // Derived from modelMatrix and scale
        this._state = ModelState.NEEDS_LOAD;
        this._loadResources = undefined;

        this._cesiumAnimationsDirty = false;       // true when the Cesium API, not a glTF animation, changed a node transform

        this._runtime = {
            animations : undefined,
            rootNodes : undefined,
            nodes : undefined,
            skinnedNodes : undefined
        };
        this._rendererResources = {
            buffers : {},
            vertexArrays : {},
            programs : {},
            pickPrograms : {},
            textures : {},

            samplers : {},
            renderStates : {},
            uniformMaps : {}
        };

        this._renderCommands = [];
        this._pickCommands = [];
        this._pickIds = [];
    };

    /**
     * Creates a model from a glTF assets.  When the model is ready to render, i.e., when the external binary, image,
     * and shader files are downloaded and the WebGL resources are created, the {@link Model#readyToRender} event is fired.
     *
     * @memberof Model
     *
     * @param {String} options.url The url to the glTF .json file.
     * @param {Boolean} [options.show=true] Determines if the model primitive will be shown.
     * @param {Matrix4} [options.modelMatrix=Matrix4.IDENTITY] The 4x4 transformation matrix that transforms the model from model to world coordinates.
     * @param {Number} [options.scale=1.0] A uniform scale applied to this model.
     * @param {Object} [options.allowPicking=true] When <code>true</code>, each glTF mesh and primitive is pickable with {@link Scene#pick}.
     * @param {Event} [options.readyToRender=new Event()] The event fired when this model is ready to render.
     * @param {Boolean} [options.debugShowBoundingVolume=false] For debugging only. Draws the bounding sphere for each {@link DrawCommand} in the model.
     * @param {Boolean} [options.debugWireframe=false] For debugging only. Draws the model in wireframe.
     *
     * @returns {Model} The newly created model.
     *
     * @exception {DeveloperError} options.url is required.
     *
     * @example
     * // Example 1. Create a model from a glTF asset
     * var model = scene.getPrimitives().add(Model.fromGltf({
     *   url : './duck/duck.json'
     * }));
     *
     * // Example 2. Create model and provide all properties and events
     * var origin = ellipsoid.cartographicToCartesian(
     *   Cartographic.fromDegrees(-95.0, 40.0, 200000.0));
     * var modelMatrix = Transforms.eastNorthUpToFixedFrame(origin);
     *
     * var readyToRender = new Event();
     * readyToRender.addEventListener(function(model) {
     *   // Play all animations when the model is ready to render
     *   model.activeAnimations.addAll();
     * });
     *
     * var model = scene.getPrimitives().add(Model.fromGltf({
     *   url : './duck/duck.json',
     *   show : true,                     // default
     *   modelMatrix : modelMatrix,
     *   scale : 2.0,                     // double size
     *   allowPicking : false,            // not pickable
     *   readyToRender : readyToRender,
     *   debugShowBoundingVolume : false, // default
     *   debugWireframe : false
     * }));
     *
     * @see Model#readyToRender
     */
    Model.fromGltf = function(options) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(options) || !defined(options.url)) {
            throw new DeveloperError('options.url is required');
        }
        //>>includeEnd('debug');

        var url = options.url;
        var basePath = '';
        var i = url.lastIndexOf('/');
        if (i !== -1) {
            basePath = url.substring(0, i + 1);
        }

        var model = new Model(options);

        loadText(url, options.headers).then(function(data) {
            model.gltf = gltfDefaults(JSON.parse(data));
            model.basePath = basePath;
        });

        return model;
    };

    /**
     * Returns the glTF node with the given <code>name</code>.  This is used to
     * modify a node's transform for animation outside of glTF animations.
     *
     * @memberof Model
     *
     * @param {String} name The glTF name of the node.
     *
     * @returns {ModelNode} The node or <code>undefined</code> if no node with <code>name</code> was found.
     *
     * @exception {DeveloperError} Nodes are not loaded.  Wait for the model's readyToRender event.
     * @exception {DeveloperError} name is required.
     *
     * @example
     * // Apply non-uniform scale to node LOD3sp
     * var node = model.getNode('LOD3sp');
     * node.matrix = Matrix4.fromScale(new Cartesian3(5.0, 1.0, 1.0), node.matrix);
     */
    Model.prototype.getNode = function(name) {
        var nodes = this._runtime.nodes;

        //>>includeStart('debug', pragmas.debug);
        if (!defined(nodes)) {
            throw new DeveloperError('Nodes are not loaded.  Wait for the model\'s readyToRender event.');
        }

        if (!defined(name)) {
            throw new DeveloperError('name is required.');
        }
        //>>includeEnd('debug');

        var node = nodes[name];
        return defined(node) ? node.publicNode : undefined;
    };

    ///////////////////////////////////////////////////////////////////////////

    function getFailedLoadFunction(type, path) {
        return function() {
            throw new RuntimeError('Failed to load external ' + type + ': ' + path);
        };
    }

    function bufferLoad(model, name) {
        return function(arrayBuffer) {
            var loadResources = model._loadResources;
            loadResources.buffers[name] = arrayBuffer;
            --loadResources.pendingBufferLoads;
         };
    }

    function parseBuffers(model) {
        var buffers = model.gltf.buffers;
        for (var name in buffers) {
            if (buffers.hasOwnProperty(name)) {
                ++model._loadResources.pendingBufferLoads;
                var bufferPath = model.basePath + buffers[name].path;
                loadArrayBuffer(bufferPath).then(bufferLoad(model, name), getFailedLoadFunction('buffer', bufferPath));
            }
        }
    }

    function parseBufferViews(model) {
        var bufferViews = model.gltf.bufferViews;
        for (var name in bufferViews) {
            if (bufferViews.hasOwnProperty(name)) {
                model._loadResources.buffersToCreate.enqueue(name);
            }
        }
    }

    function shaderLoad(model, name) {
        return function(source) {
            var loadResources = model._loadResources;
            loadResources.shaders[name] = source;
            --loadResources.pendingShaderLoads;
         };
    }

    function parseShaders(model) {
        var shaders = model.gltf.shaders;
        for (var name in shaders) {
            if (shaders.hasOwnProperty(name)) {
                ++model._loadResources.pendingShaderLoads;
                var shaderPath = model.basePath + shaders[name].path;
                loadText(shaderPath).then(shaderLoad(model, name), getFailedLoadFunction('shader', shaderPath));
            }
        }
    }

    function parsePrograms(model) {
        var programs = model.gltf.programs;
        for (var name in programs) {
            if (programs.hasOwnProperty(name)) {
                model._loadResources.programsToCreate.enqueue(name);
            }
        }
    }

    function imageLoad(model, name) {
        return function(image) {
            var loadResources = model._loadResources;
            --loadResources.pendingTextureLoads;
            loadResources.texturesToCreate.enqueue({
                 name : name,
                 image : image
             });
         };
    }

    function parseTextures(model) {
        var images = model.gltf.images;
        var textures = model.gltf.textures;
        for (var name in textures) {
            if (textures.hasOwnProperty(name)) {
                ++model._loadResources.pendingTextureLoads;
                var imagePath = model.basePath + images[textures[name].source].path;
                loadImage(imagePath).then(imageLoad(model, name), getFailedLoadFunction('image', imagePath));
            }
        }
    }

    function parseNodes(model) {
        var runtimeNodes = {};
        var skinnedNodes = [];

        var skinnedNodesNames = model._loadResources.skinnedNodesNames;
        var nodes = model.gltf.nodes;

        for (var name in nodes) {
            if (nodes.hasOwnProperty(name)) {
                var node = nodes[name];

                var runtimeNode = {
                    // Animation targets
                    matrix : undefined,
                    translation : undefined,
                    rotation : undefined,
                    scale : undefined,

                    // Computed transforms
                    transformToRoot : new Matrix4(),
                    computedMatrix : new Matrix4(),
                    dirty : false,                      // for graph traversal
                    anyAncestorDirty : false,           // for graph traversal

                    // Rendering
                    commands : [],                      // empty for transform, light, and camera nodes

                    // Skinned node
                    inverseBindMatrices : undefined,    // undefined when node is not skinned
                    bindShapeMatrix : undefined,        // undefined when node is not skinned or identity
                    joints : [],                        // empty when node is not skinned
                    computedJointMatrices : [],         // empty when node is not skinned

                    // Joint node
                    jointId : node.jointId,             // undefined when node is not a joint

                    // Graph pointers
                    children : [],                      // empty for leaf nodes
                    parents : [],                       // empty for root nodes

                    // Publicly-accessible ModelNode instance to modify animation targets
                    publicNode : undefined
                };
                runtimeNode.publicNode = new ModelNode(model, runtimeNode);

                runtimeNodes[name] = runtimeNode;

                if (defined(node.instanceSkin)) {
                    skinnedNodesNames.push(name);
                    skinnedNodes.push(runtimeNode);
                }
            }
        }

        model._runtime.nodes = runtimeNodes;
        model._runtime.skinnedNodes = skinnedNodes;
    }

    function parse(model) {
        parseBuffers(model);
        parseBufferViews(model);
        parseShaders(model);
        parsePrograms(model);
        parseTextures(model);
        parseNodes(model);
    }

    ///////////////////////////////////////////////////////////////////////////

    function createBuffers(model, context) {
        var loadResources = model._loadResources;

        if (loadResources.pendingBufferLoads !== 0) {
            return;
        }

        var raw;
        var bufferView;
        var bufferViews = model.gltf.bufferViews;
        var buffers = loadResources.buffers;
        var rendererBuffers = model._rendererResources.buffers;

        while (loadResources.buffersToCreate.length > 0) {
            var bufferViewName = loadResources.buffersToCreate.dequeue();
            bufferView = bufferViews[bufferViewName];

            if (bufferView.target === WebGLRenderingContext.ARRAY_BUFFER) {
                // Only ARRAY_BUFFER here.  ELEMENT_ARRAY_BUFFER created below.
                raw = new Uint8Array(buffers[bufferView.buffer], bufferView.byteOffset, bufferView.byteLength);
                var vertexBuffer = context.createVertexBuffer(raw, BufferUsage.STATIC_DRAW);
                vertexBuffer.setVertexArrayDestroyable(false);
                rendererBuffers[bufferViewName] = vertexBuffer;
            }

            // bufferViews referencing animations are ignored here and handled in createRuntimeAnimations.
            // bufferViews referencing skins are ignored here and handled in createSkins.
        }

        // The Cesium Renderer requires knowing the datatype for an index buffer
        // at creation type, which is not part of the glTF bufferview so loop
        // through glTF accessors to create the bufferview's index buffer.
        var accessors = model.gltf.accessors;
        for (var name in accessors) {
            if (accessors.hasOwnProperty(name)) {
                var instance = accessors[name];
                bufferView = bufferViews[instance.bufferView];

                if ((bufferView.target === WebGLRenderingContext.ELEMENT_ARRAY_BUFFER) && !defined(rendererBuffers[instance.bufferView])) {
                    raw = new Uint8Array(buffers[bufferView.buffer], bufferView.byteOffset, bufferView.byteLength);
                    var indexBuffer = context.createIndexBuffer(raw, BufferUsage.STATIC_DRAW, instance.type);
                    indexBuffer.setVertexArrayDestroyable(false);
                    rendererBuffers[instance.bufferView] = indexBuffer;
                    // In theory, several glTF accessors with different types could
                    // point to the same glTF bufferView, which would break this.
                    // In practice, it is unlikely as it will be UNSIGNED_SHORT.
                }
            }
        }
    }

    function createAttributeLocations(attributes) {
        var attributeLocations = {};
        var length = attributes.length;

        for (var i = 0; i < length; ++i) {
            attributeLocations[attributes[i]] = i;
        }

        return attributeLocations;
    }

    function createPrograms(model, context) {
        var loadResources = model._loadResources;

        if (loadResources.pendingShaderLoads !== 0) {
            return;
        }

        var programs = model.gltf.programs;
        var shaders = loadResources.shaders;

        // Create one program per frame
        if (loadResources.programsToCreate.length > 0) {
            var name = loadResources.programsToCreate.dequeue();
            var program = programs[name];

            var attributeLocations = createAttributeLocations(program.attributes);
            var vs = shaders[program.vertexShader];
            var fs = shaders[program.fragmentShader];

            model._rendererResources.programs[name] = context.getShaderCache().getShaderProgram(vs, fs, attributeLocations);

            if (model.allowPicking) {
             // TODO: Can optimize this shader with a glTF hint. https://github.com/KhronosGroup/glTF/issues/181
                var pickFS = createShaderSource({
                    sources : [fs],
                    pickColorQualifier : 'uniform'
                });
                model._rendererResources.pickPrograms[name] = context.getShaderCache().getShaderProgram(vs, pickFS, attributeLocations);
            }
        }
    }

    function createSamplers(model, context) {
        var loadResources = model._loadResources;

        if (loadResources.createSamplers) {
            loadResources.createSamplers = false;

            var rendererSamplers = model._rendererResources.samplers;
            var samplers = model.gltf.samplers;
            for (var name in samplers) {
                if (samplers.hasOwnProperty(name)) {
                    var sampler = samplers[name];

                    rendererSamplers[name] = context.createSampler({
                        wrapS : sampler.wrapS,
                        wrapT : sampler.wrapT,
                        minificationFilter : sampler.minFilter,
                        magnificationFilter : sampler.magFilter
                    });
                }
            }
        }
    }

    function createTextures(model, context) {
        var loadResources = model._loadResources;
        var textures = model.gltf.textures;
        var rendererSamplers = model._rendererResources.samplers;

        // Create one texture per frame
        if (loadResources.texturesToCreate.length > 0) {
            var textureToCreate = loadResources.texturesToCreate.dequeue();
            var texture = textures[textureToCreate.name];
            var sampler = rendererSamplers[texture.sampler];

            var mipmap =
                (sampler.minificationFilter === TextureMinificationFilter.NEAREST_MIPMAP_NEAREST) ||
                (sampler.minificationFilter === TextureMinificationFilter.NEAREST_MIPMAP_LINEAR) ||
                (sampler.minificationFilter === TextureMinificationFilter.LINEAR_MIPMAP_NEAREST) ||
                (sampler.minificationFilter === TextureMinificationFilter.LINEAR_MIPMAP_LINEAR);
            var requiresNpot = mipmap ||
                (sampler.wrapS === TextureWrap.REPEAT) ||
                (sampler.wrapS === TextureWrap.MIRRORED_REPEAT) ||
                (sampler.wrapT === TextureWrap.REPEAT) ||
                (sampler.wrapT === TextureWrap.MIRRORED_REPEAT);

            var source = textureToCreate.image;
            var npot = !CesiumMath.isPowerOfTwo(source.width) || !CesiumMath.isPowerOfTwo(source.height);

            if (requiresNpot && npot) {
                // WebGL requires power-of-two texture dimensions for mipmapping and REPEAT/MIRRORED_REPEAT wrap modes.
                var canvas = document.createElement('canvas');
                canvas.width = CesiumMath.nextPowerOfTwo(source.width);
                canvas.height = CesiumMath.nextPowerOfTwo(source.height);
                var canvasContext = canvas.getContext('2d');
                canvasContext.drawImage(source, 0, 0, source.width, source.height, 0, 0, canvas.width, canvas.height);
                source = canvas;
            }

// TODO: texture cache
            var tx;

            if (texture.target === WebGLRenderingContext.TEXTURE_2D) {
                tx = context.createTexture2D({
                    source : source,
                    pixelFormat : texture.internalFormat,
                    flipY : false
                });
            }
            // TODO: else handle WebGLRenderingContext.TEXTURE_CUBE_MAP.  https://github.com/KhronosGroup/glTF/issues/40

            if (mipmap) {
                tx.generateMipmap();
            }
            tx.setSampler(sampler);

            model._rendererResources.textures[textureToCreate.name] = tx;
        }
    }

    function getAttributeLocations(model, primitive) {
        var gltf = model.gltf;
        var programs = gltf.programs;
        var techniques = gltf.techniques;
        var materials = gltf.materials;

        // Retrieve the compiled shader program to assign index values to attributes
        var attributeLocations = {};

        var technique = techniques[materials[primitive.material].instanceTechnique.technique];
        var parameters = technique.parameters;
        var pass = technique.passes[technique.pass];
        var instanceProgram = pass.instanceProgram;
        var attributes = instanceProgram.attributes;
        var programAttributeLocations = model._rendererResources.programs[instanceProgram.program].getVertexAttributes();

        for (var name in attributes) {
            if (attributes.hasOwnProperty(name)) {
                var parameter = parameters[attributes[name]];

                attributeLocations[parameter.semantic] = programAttributeLocations[name].index;
            }
        }

        return attributeLocations;
    }

    function searchForest(forest, jointId) {
        var length = forest.length;
        for (var i = 0; i < length; ++i) {
            var stack = [forest[i]]; // Push root node of tree

            while (stack.length > 0) {
                var n = stack.pop();

                if (n.jointId === jointId) {
                    return n;
                }

                var children = n.children;
                var childrenLength = children.length;
                for (var k = 0; k < childrenLength; ++k) {
                    stack.push(children[k]);
                }
            }
        }

        // This should never happen; the skeleton should have a node for all joints in the skin.
        return undefined;
    }

    function createJoints(model, runtimeSkins) {
        var gltf = model.gltf;
        var skins = gltf.skins;
        var nodes = gltf.nodes;
        var runtimeNodes = model._runtime.nodes;

        var skinnedNodesNames = model._loadResources.skinnedNodesNames;
        var length = skinnedNodesNames.length;
        for (var j = 0; j < length; ++j) {
            var name = skinnedNodesNames[j];
            var skinnedNode = runtimeNodes[name];
            var instanceSkin = nodes[name].instanceSkin;

            var runtimeSkin = runtimeSkins[instanceSkin.skin];
            skinnedNode.inverseBindMatrices = runtimeSkin.inverseBindMatrices;
            skinnedNode.bindShapeMatrix = runtimeSkin.bindShapeMatrix;

            // 1. Find nodes with the names in instanceSkin.skeletons (the node's skeletons)
            // 2. These nodes form the root nodes of the forest to search for each joint in skin.joints.  This search uses jointId, not the node's name.

            var forest = [];
            var gltfSkeletons = instanceSkin.skeletons;
            var skeletonsLength = gltfSkeletons.length;
            for (var k = 0; k < skeletonsLength; ++k) {
                forest.push(runtimeNodes[gltfSkeletons[k]]);
            }

            var gltfJointIds = skins[instanceSkin.skin].joints;
            var jointIdsLength = gltfJointIds.length;
            for (var i = 0; i < jointIdsLength; ++i) {
                var jointId = gltfJointIds[i];
                skinnedNode.joints.push(searchForest(forest, jointId));
            }
        }
    }

    function createSkins(model) {
        var loadResources = model._loadResources;

        if (!loadResources.finishedBuffersCreation()) {
            return;
        }

        if (!loadResources.createSkins) {
            return;
        }
        loadResources.createSkins = false;

        var gltf = model.gltf;
        var buffers = loadResources.buffers;
        var bufferViews = gltf.bufferViews;
        var skins = gltf.skins;
        var runtimeSkins = {};

        for (var name in skins) {
            if (skins.hasOwnProperty(name)) {
                var skin = skins[name];
                var inverseBindMatrices = skin.inverseBindMatrices;
                var bufferView = bufferViews[inverseBindMatrices.bufferView];

                var type = inverseBindMatrices.type;
                var count = inverseBindMatrices.count;

// TODO: move to ModelCache.
                var typedArray = ModelTypes[type].createArrayBufferView(buffers[bufferView.buffer], bufferView.byteOffset + inverseBindMatrices.byteOffset, count);
                var matrices =  new Array(count);

                if (type === WebGLRenderingContext.FLOAT_MAT4) {
                    for (var i = 0; i < count; ++i) {
                        matrices[i] = Matrix4.fromArray(typedArray, 16 * i);
                    }
                }
                // TODO: else handle all valid types: https://github.com/KhronosGroup/glTF/issues/191

                var bindShapeMatrix;
                if (!Matrix4.equals(skin.bindShapeMatrix, Matrix4.IDENTITY)) {
                    bindShapeMatrix = Matrix4.clone(skin.bindShapeMatrix);
                }

                runtimeSkins[name] = {
                    inverseBindMatrices : matrices,
                    bindShapeMatrix : bindShapeMatrix // not used when undefined
                };
            }
        }

        createJoints(model, runtimeSkins);
    }

    function getChannelEvaluator(runtimeNode, targetPath, spline) {
        return function(localAnimationTime) {
            runtimeNode[targetPath] = spline.evaluate(localAnimationTime, runtimeNode[targetPath]);
            runtimeNode.dirty = true;
        };
    }

    function createRuntimeAnimations(model) {
        var loadResources = model._loadResources;

        if (!loadResources.finishedPendingLoads()) {
            return;
        }

        if (!loadResources.createRuntimeAnimations) {
            return;
        }
        loadResources.createRuntimeAnimations = false;

        model._runtime.animations = {
        };

        var runtimeNodes = model._runtime.nodes;
        var animations = model.gltf.animations;
        var accessors = model.gltf.accessors;
        var name;

         for (var animationName in animations) {
             if (animations.hasOwnProperty(animationName)) {
                 var animation = animations[animationName];
                 var channels = animation.channels;
                 var parameters = animation.parameters;
                 var samplers = animation.samplers;

                 var parameterValues = {};

                 for (name in parameters) {
                     if (parameters.hasOwnProperty(name)) {
                         parameterValues[name] = ModelCache.getAnimationParameterValues(model, accessors[parameters[name]]);
                     }
                 }

                 // Find start and stop time for the entire animation
                 var startTime = Number.MAX_VALUE;
                 var stopTime = -Number.MAX_VALUE;

                 var length = channels.length;
                 var channelEvaluators = new Array(length);

                 for (var i = 0; i < length; ++i) {
                     var channel = channels[i];
                     var target = channel.target;
                     var sampler = samplers[channel.sampler];
                     var times = parameterValues[sampler.input];

                     startTime = Math.min(startTime, times[0]);
                     stopTime = Math.max(stopTime, times[times.length - 1]);

                     var spline = ModelCache.getAnimationSpline(model, animationName, animation, channel.sampler, sampler, parameterValues);
                     // TODO: Support other targets when glTF does: https://github.com/KhronosGroup/glTF/issues/142
                     channelEvaluators[i] = getChannelEvaluator(runtimeNodes[target.id], target.path, spline);
                 }

                 model._runtime.animations[animationName] = {
                     startTime : startTime,
                     stopTime : stopTime,
                     channelEvaluators : channelEvaluators
                 };
             }
         }
    }

    function createVertexArrays(model, context) {
        var loadResources = model._loadResources;

        if (!loadResources.finishedBuffersCreation() || !loadResources.finishedProgramCreation()) {
            return;
        }

        if (!loadResources.createVertexArrays) {
            return;
        }
        loadResources.createVertexArrays = false;

        var rendererBuffers = model._rendererResources.buffers;
        var rendererVertexArrays = model._rendererResources.vertexArrays;
        var gltf = model.gltf;
        var accessors = gltf.accessors;
        var meshes = gltf.meshes;

        for (var meshName in meshes) {
            if (meshes.hasOwnProperty(meshName)) {
                var primitives = meshes[meshName].primitives;
                var primitivesLength = primitives.length;

                for (var i = 0; i < primitivesLength; ++i) {
                    var primitive = primitives[i];

                    var attributeLocations = getAttributeLocations(model, primitive);
                    var attrs = [];
                    var primitiveAttributes = primitive.attributes;
                    for (var attrName in primitiveAttributes) {
                        if (primitiveAttributes.hasOwnProperty(attrName)) {
                            var a = accessors[primitiveAttributes[attrName]];

                            var type = ModelTypes[a.type];
                            attrs.push({
                                index                  : attributeLocations[attrName],
                                vertexBuffer           : rendererBuffers[a.bufferView],
                                componentsPerAttribute : type.componentsPerAttribute,
                                componentDatatype      : type.componentDatatype,
                                normalize              : false,
                                offsetInBytes          : a.byteOffset,
                                strideInBytes          : a.byteStride
                            });
                        }
                    }

                    var accessor = accessors[primitive.indices];
                    var indexBuffer = rendererBuffers[accessor.bufferView];
                    rendererVertexArrays[meshName + '.primitive.' + i] = context.createVertexArray(attrs, indexBuffer);
                }
            }
        }
    }

    function createRenderStates(model, context) {
        var loadResources = model._loadResources;

        if (loadResources.createRenderStates) {
            loadResources.createRenderStates = false;
            var rendererRenderStates = model._rendererResources.renderStates;
            var techniques = model.gltf.techniques;
            for (var name in techniques) {
                if (techniques.hasOwnProperty(name)) {
                    var technique = techniques[name];
                    var pass = technique.passes[technique.pass];
                    var states = pass.states;

                    rendererRenderStates[name] = context.createRenderState({
                        cull : {
                            enabled : !!states.cullFaceEnable
                        },
                        depthTest : {
                            enabled : !!states.depthTestEnable
                        },
                        depthMask : !!states.depthMask,
                        blending : !!states.blendEnable ? BlendingState.ALPHA_BLEND : BlendingState.DISABLED
                    });
                }
            }
        }
    }

    var gltfSemanticUniforms = {
// TODO: All semantics from https://github.com/KhronosGroup/glTF/issues/83
        MODEL : function(uniformState) {
            return function() {
                return uniformState.getModel();
            };
        },
        VIEW : function(uniformState) {
            return function() {
                return uniformState.getView();
            };
        },
        PROJECTION : function(uniformState) {
            return function() {
                return uniformState.getProjection();
            };
        },
        MODELVIEW : function(uniformState) {
            return function() {
                return uniformState.getModelView();
            };
        },
        VIEWPROJECTION : function(uniformState) {
            return function() {
                return uniformState.getViewProjection();
            };
        },
        MODELVIEWPROJECTION : function(uniformState) {
            return function() {
                return uniformState.getModelViewProjection();
            };
        },
        MODELINVERSE : function(uniformState) {
            return function() {
                return uniformState.getInverseModel();
            };
        },
        VIEWINVERSE : function(uniformState) {
            return function() {
                return uniformState.getInverseView();
            };
        },
        PROJECTIONINVERSE : function(uniformState) {
            return function() {
                return uniformState.getInverseProjection();
            };
        },
        MODELVIEWINVERSE : function(uniformState) {
            return function() {
                return uniformState.getInverseModelView();
            };
        },
        VIEWPROJECTIONINVERSE : function(uniformState) {
            return function() {
                return uniformState.getInverseViewProjection();
            };
        },
        MODELVIEWINVERSETRANSPOSE : function(uniformState) {
            return function() {
                return uniformState.getNormal();
            };
        }
        // JOINT_MATRIX created in createCommands()
    };

    ///////////////////////////////////////////////////////////////////////////

    function getScalarUniformFunction(value, model) {
        return function() {
            return value;
        };
    }

    function getVec2UniformFunction(value, model) {
        var v = Cartesian2.fromArray(value);

        return function() {
            return v;
        };
    }

    function getVec3UniformFunction(value, model) {
        var v = Cartesian3.fromArray(value);

        return function() {
            return v;
        };
    }

    function getVec4UniformFunction(value, model) {
        var v = Cartesian4.fromArray(value);

        return function() {
            return v;
        };
    }

    function getMat2UniformFunction(value, model) {
        var v = Matrix2.fromColumnMajorArray(value);

        return function() {
            return v;
        };
    }

    function getMat3UniformFunction(value, model) {
        var v = Matrix3.fromColumnMajorArray(value);

        return function() {
            return v;
        };
    }

    function getMat4UniformFunction(value, model) {
        var v = Matrix4.fromColumnMajorArray(value);

        return function() {
            return v;
        };
    }

    function getTextureUniformFunction(value, model) {
        var tx = model._rendererResources.textures[value];

        return function() {
            return tx;
        };
    }

    var gltfUniformFunctions = {
    };

    gltfUniformFunctions[WebGLRenderingContext.FLOAT] = getScalarUniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.FLOAT_VEC2] = getVec2UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.FLOAT_VEC3] = getVec3UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.FLOAT_VEC4] = getVec4UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.INT] = getScalarUniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.INT_VEC2] = getVec2UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.INT_VEC3] = getVec3UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.INT_VEC4] = getVec4UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.BOOL] = getScalarUniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.BOOL_VEC2] = getVec2UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.BOOL_VEC3] = getVec3UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.BOOL_VEC4] = getVec4UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.FLOAT_MAT2] = getMat2UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.FLOAT_MAT3] = getMat3UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.FLOAT_MAT4] = getMat4UniformFunction;
    gltfUniformFunctions[WebGLRenderingContext.SAMPLER_2D] = getTextureUniformFunction;
    // TODO: function for gltfUniformFunctions[WebGLRenderingContext.SAMPLER_CUBE].  https://github.com/KhronosGroup/glTF/issues/40

    function getUniformFunctionFromSource(source, model) {
        var runtimeNode = model._runtime.nodes[source];
        return function() {
            return runtimeNode.computedMatrix;
        };
    }

    function createUniformMaps(model, context) {
        var loadResources = model._loadResources;

        if (!loadResources.finishedTextureCreation() || !loadResources.finishedProgramCreation()) {
            return;
        }

        if (!loadResources.createUniformMaps) {
            return;
        }
        loadResources.createUniformMaps = false;

        var gltf = model.gltf;
        var materials = gltf.materials;
        var techniques = gltf.techniques;
        var programs = gltf.programs;
        var rendererUniformMaps = model._rendererResources.uniformMaps;

        for (var materialName in materials) {
            if (materials.hasOwnProperty(materialName)) {
                var material = materials[materialName];
                var instanceTechnique = material.instanceTechnique;
                var instanceParameters = instanceTechnique.values;
                var technique = techniques[instanceTechnique.technique];
                var parameters = technique.parameters;
                var pass = technique.passes[technique.pass];
                var instanceProgram = pass.instanceProgram;
                var uniforms = instanceProgram.uniforms;
                var activeUniforms = model._rendererResources.programs[instanceProgram.program].getAllUniforms();

                var parameterValues = {};
                var jointMatrixUniformName;

                // Uniform parameters for this pass
                for (var name in uniforms) {
                    if (uniforms.hasOwnProperty(name)) {
                        // Only add active uniforms
                        if (defined(activeUniforms[name])) {
                            var parameterName = uniforms[name];
                            var parameter = parameters[parameterName];

                            var func;

                            if (defined(instanceParameters[parameterName])) {
                                // Parameter overrides by the instance technique
                                func = gltfUniformFunctions[parameter.type](instanceParameters[parameterName], model);
                            } else if (defined(parameter.semantic)) {
// TODO: account for parameter.type with semantic
                                if (parameter.semantic !== 'JOINT_MATRIX') {
                                    // Map glTF semantic to Cesium automatic uniform
                                    func = gltfSemanticUniforms[parameter.semantic](context.getUniformState());
                                } else {
                                    func = undefined;
                                    jointMatrixUniformName = name;
                                }
                            } else if (defined(parameter.source)) {
                                func = getUniformFunctionFromSource(parameter.source, model);
                            } else if (defined(parameter.value)) {
                                // Default technique value that may be overridden by a material
                                func = gltfUniformFunctions[parameter.type](parameter.value, model);
                            }

                            if (defined(func)) {
                                parameterValues[parameterName] = {
                                    uniformName : name,
                                    func : func
                                };
                            }
                        }
                    }
                }

                // Create uniform map
                var uniformMap = {};
                for (name in parameterValues) {
                    if (parameterValues.hasOwnProperty(name)) {
                        var pv = parameterValues[name];
                        uniformMap[pv.uniformName] = pv.func;
                    }
                }

                rendererUniformMaps[materialName] = {
                    uniformMap : uniformMap,
                    jointMatrixUniformName : jointMatrixUniformName
                };
            }
        }
    }

    function createPickColorFunction(color) {
        return function() {
            return color;
        };
    }

    function createJointMatricesFunction(runtimeNode) {
        return function() {
            return runtimeNode.computedJointMatrices;
        };
    }

    function createCommand(model, gltfNode, runtimeNode, context) {
        var commands = model._renderCommands;
        var pickCommands = model._pickCommands;
        var pickIds = model._pickIds;
        var allowPicking = model.allowPicking;

        var debugShowBoundingVolume = model.debugShowBoundingVolume;

        var resources = model._rendererResources;
        var rendererVertexArrays = resources.vertexArrays;
        var rendererPrograms = resources.programs;
        var rendererPickPrograms = resources.pickPrograms;
        var rendererRenderStates = resources.renderStates;
        var rendererUniformMaps = resources.uniformMaps;

        var gltf = model.gltf;
        var accessors = gltf.accessors;
        var gltfMeshes = gltf.meshes;
        var techniques = gltf.techniques;
        var materials = gltf.materials;

        var meshes = defined(gltfNode.meshes) ? gltfNode.meshes : gltfNode.instanceSkin.sources;
        var meshesLength = meshes.length;

        for (var j = 0; j < meshesLength; ++j) {
            var name = meshes[j];
            var mesh = gltfMeshes[name];
            var primitives = mesh.primitives;
            var length = primitives.length;

            // The glTF node hierarchy is a DAG so a node can have more than one
            // parent, so a node may already have commands.  If so, append more
            // since they will have a different model matrix.

            for (var i = 0; i < length; ++i) {
                var primitive = primitives[i];
                var ix = accessors[primitive.indices];
                var instanceTechnique = materials[primitive.material].instanceTechnique;
                var technique = techniques[instanceTechnique.technique];
                var pass = technique.passes[technique.pass];
                var instanceProgram = pass.instanceProgram;

                var boundingSphere;
                var positionAttribute = primitive.attributes.POSITION;
                if (defined(positionAttribute)) {
                    var a = accessors[positionAttribute];
                    boundingSphere = BoundingSphere.fromCornerPoints(Cartesian3.fromArray(a.min), Cartesian3.fromArray(a.max));
                }

                var vertexArray = rendererVertexArrays[name + '.primitive.' + i];
                var count = ix.count;
                var offset = (ix.byteOffset / IndexDatatype.getSizeInBytes(ix.type));  // glTF has offset in bytes.  Cesium has offsets in indices

                var um = rendererUniformMaps[primitive.material];
                var uniformMap = um.uniformMap;
                if (defined(um.jointMatrixUniformName)) {
                    var jointUniformMap = {};
                    jointUniformMap[um.jointMatrixUniformName] = createJointMatricesFunction(runtimeNode);

                    uniformMap = combine([uniformMap, jointUniformMap], false, false);
                }

                var isTranslucent = pass.states.blendEnable; // TODO: Offical way to test this: https://github.com/KhronosGroup/glTF/issues/105
                var rs = rendererRenderStates[instanceTechnique.technique];
                var owner = {
                    primitive : model,
                    id : model.id,
                    gltf : {
                        node : gltfNode,
                        mesh : mesh,
                        primitive : primitive,
                        primitiveIndex : i
                    }
                };

                var command = new DrawCommand();
                command.boundingVolume = new BoundingSphere(); // updated in update()
                command.modelMatrix = new Matrix4();           // computed in update()
                command.primitiveType = primitive.primitive;
                command.vertexArray = vertexArray;
                command.count = count;
                command.offset = offset;
                command.shaderProgram = rendererPrograms[instanceProgram.program];
                command.uniformMap = uniformMap;
                command.renderState = rs;
                command.owner = owner;
                command.debugShowBoundingVolume = debugShowBoundingVolume;
                command.pass = isTranslucent ? Pass.TRANSLUCENT : Pass.OPAQUE;
                commands.push(command);

                var pickCommand;

                if (allowPicking) {
                    var pickId = context.createPickId(owner);
                    pickIds.push(pickId);

                    var pickUniformMap = combine([
                        uniformMap, {
                            czm_pickColor : createPickColorFunction(pickId.color)
                        }], false, false);

                    pickCommand = new DrawCommand();
                    pickCommand.boundingVolume = new BoundingSphere(); // updated in update()
                    pickCommand.modelMatrix = new Matrix4();           // computed in update()
                    pickCommand.primitiveType = primitive.primitive;
                    pickCommand.vertexArray = vertexArray;
                    pickCommand.count = count;
                    pickCommand.offset = offset;
                    pickCommand.shaderProgram = rendererPickPrograms[instanceProgram.program];
                    pickCommand.uniformMap = pickUniformMap;
                    pickCommand.renderState = rs;
                    pickCommand.owner = owner;
                    pickCommand.pass = isTranslucent ? Pass.TRANSLUCENT : Pass.OPAQUE;
                    pickCommands.push(pickCommand);
                }

                runtimeNode.commands.push({
                    command : command,
                    pickCommand : pickCommand,
                    boundingSphere : boundingSphere
                });
            }
        }
    }

    function createRuntimeNodes(model, context) {
        var loadResources = model._loadResources;

        if (!loadResources.finishedPendingLoads() || !loadResources.finishedResourceCreation()) {
            return;
        }

        if (!loadResources.createRuntimeNodes) {
            return;
        }
        loadResources.createRuntimeNodes = false;

        var rootNodes = [];
        var runtimeNodes = model._runtime.nodes;

        var gltf = model.gltf;
        var nodes = gltf.nodes;

        var scene = gltf.scenes[gltf.scene];
        var sceneNodes = scene.nodes;
        var length = sceneNodes.length;

        var stack = [];
        var axis = new Cartesian3();

        var matrix;
        var translation;
        var rotation;
        var scale;

        for (var i = 0; i < length; ++i) {
            stack.push({
                parentRuntimeNode : undefined,
                gltfNode : nodes[sceneNodes[i]],
                id : sceneNodes[i]
            });

            while (stack.length > 0) {
                var n = stack.pop();
                var parentRuntimeNode = n.parentRuntimeNode;
                var gltfNode = n.gltfNode;

                // Node hierarchy is a DAG so a node can have more than one parent so it may already exist
                var runtimeNode = runtimeNodes[n.id];
                if (runtimeNode.parents.length === 0) {
                    if (defined(gltfNode.matrix)) {
                        runtimeNode.matrix = Matrix4.fromColumnMajorArray(gltfNode.matrix);
                    } else {
                        // TRS converted to Cesium types
                        axis = Cartesian3.fromArray(gltfNode.rotation, 0, axis);
                        runtimeNode.translation = Cartesian3.fromArray(gltfNode.translation);
                        runtimeNode.rotation = Quaternion.fromAxisAngle(axis, gltfNode.rotation[3]);
                        runtimeNode.scale = Cartesian3.fromArray(gltfNode.scale);
                    }
                }

                if (defined(parentRuntimeNode)) {
                    parentRuntimeNode.children.push(runtimeNode);
                    runtimeNode.parents.push(parentRuntimeNode);
                } else {
                    rootNodes.push(runtimeNode);
                }

                if (defined(gltfNode.meshes) || defined(gltfNode.instanceSkin)) {
                    createCommand(model, gltfNode, runtimeNode, context);
                }

                var children = gltfNode.children;
                var childrenLength = children.length;
                for (var k = 0; k < childrenLength; ++k) {
                    stack.push({
                        parentRuntimeNode : runtimeNode,
                        gltfNode : nodes[children[k]],
                        id : children[k]
                    });
                }
            }
        }

        model._runtime.rootNodes = rootNodes;
        model._runtime.nodes = runtimeNodes;
    }

    function createResources(model, context) {
        createBuffers(model, context);      // using glTF bufferViews
        createPrograms(model, context);
        createSamplers(model, context);
        createTextures(model, context);

        createSkins(model);
        createRuntimeAnimations(model);
        createVertexArrays(model, context); // using glTF meshes
        createRenderStates(model, context); // using glTF materials/techniques/passes/states
        createUniformMaps(model, context);  // using glTF materials/techniques/passes/instanceProgram
        createRuntimeNodes(model, context); // using glTF scene
    }

    ///////////////////////////////////////////////////////////////////////////

    function getNodeMatrix(node, result) {
        if (defined(node.matrix)) {
            result = node.matrix;
            return node.matrix;
        }

        return Matrix4.fromTranslationQuaternionRotationScale(node.translation, node.rotation, node.scale, result);
    }

    var scratchNodeStack = [];
    var scratchSphereCenter = new Cartesian3();
    var scratchSpheres = [];
    var scratchSubtract = new Cartesian3();

    function updateNodeHierarchyModelMatrix(model, modelTransformChanged, justLoaded) {
        var allowPicking = model.allowPicking;
        var gltf = model.gltf;

        var rootNodes = model._runtime.rootNodes;
        var length = rootNodes.length;

        var nodeStack = scratchNodeStack;
        var computedModelMatrix = model._computedModelMatrix;

        // Compute bounding sphere that includes all transformed nodes
        Cartesian3.clone(Cartesian3.ZERO, scratchSphereCenter);
        scratchSpheres.length = 0;
        var spheres = scratchSpheres;

        for (var i = 0; i < length; ++i) {
            var n = rootNodes[i];

            n.transformToRoot = getNodeMatrix(n, n.transformToRoot);
            nodeStack.push(n);

            while (nodeStack.length > 0) {
                n = nodeStack.pop();
                var transformToRoot = n.transformToRoot;
                var commands = n.commands;

                // This nodes transform needs to be updated if
                // - It was targeted for animation this frame, or
                // - Any of its ancestors were targeted for animation this frame
                var dirty = (n.dirty || n.anyAncestorDirty);

                if (dirty || modelTransformChanged || justLoaded) {
                    var commandsLength = commands.length;
                    if (commandsLength > 0) {
                        // Node has meshes, which has primitives.  Update their commands.
                        for (var j = 0 ; j < commandsLength; ++j) {
                            var primitiveCommand = commands[j];
                            var command = primitiveCommand.command;
                            Matrix4.multiplyTransformation(computedModelMatrix, transformToRoot, command.modelMatrix);

                            // TODO: Use transformWithoutScale if no node up to the root has scale (included targeted scale from animation).
                            // Preprocess this and store it with each node.
                            BoundingSphere.transform(primitiveCommand.boundingSphere, command.modelMatrix, command.boundingVolume);
                            //BoundingSphere.transformWithoutScale(primitiveCommand.boundingSphere, command.modelMatrix, command.boundingVolume);

                            if (allowPicking) {
                                var pickCommand = primitiveCommand.pickCommand;
                                Matrix4.clone(command.modelMatrix, pickCommand.modelMatrix);
                                BoundingSphere.clone(command.boundingVolume, pickCommand.boundingVolume);
                            }

                            Cartesian3.add(command.boundingVolume.center, scratchSphereCenter, scratchSphereCenter);
                            spheres.push(command.boundingVolume);
                        }
                    } else {
                        // Node has a light or camera
                        n.computedMatrix = Matrix4.multiplyTransformation(computedModelMatrix, transformToRoot, n.computedMatrix);
                    }
                }

                n.dirty = false;
                n.anyAncestorDirty = false;

                var children = n.children;
                var childrenLength = children.length;
                for (var k = 0; k < childrenLength; ++k) {
                    var child = children[k];

                    if (dirty || justLoaded) {
                        var childMatrix = getNodeMatrix(child, child.transformToRoot);
                        Matrix4.multiplyTransformation(transformToRoot, childMatrix, child.transformToRoot);
                    }

                    child.anyAncestorDirty = dirty;
                    nodeStack.push(child);
                }
            }
        }

        if (spheres.length > 0) {
            // Compute bounding sphere around the model
            var radiusSquared = 0;
            var index = 0;

            length = spheres.length;
            Cartesian3.divideByScalar(scratchSphereCenter, length, scratchSphereCenter);
            for (i = 0; i < length; ++i) {
                var bbs = spheres[i];
                var r = Cartesian3.magnitudeSquared(Cartesian3.subtract(bbs.center, scratchSphereCenter, scratchSubtract));

                if (r > radiusSquared) {
                    radiusSquared = r;
                    index = i;
                }
            }

            // TODO: world bounding sphere is wrong unless all nodes are dirty.
            Cartesian3.clone(scratchSphereCenter, model.worldBoundingSphere.center);
            model.worldBoundingSphere.radius = Math.sqrt(radiusSquared) + spheres[index].radius;
        }
    }

    var scratchObjectSpace = new Matrix4();

    function applySkins(model) {
        var skinnedNodes = model._runtime.skinnedNodes;
        var length = skinnedNodes.length;

        for (var i = 0; i < length; ++i) {
            var node = skinnedNodes[i];

            scratchObjectSpace = Matrix4.inverseTransformation(node.transformToRoot, scratchObjectSpace);

            var computedJointMatrices = node.computedJointMatrices;
            var joints = node.joints;
            var bindShapeMatrix = node.bindShapeMatrix;
            var inverseBindMatrices = node.inverseBindMatrices;
            var inverseBindMatricesLength = inverseBindMatrices.length;

            for (var m = 0; m < inverseBindMatricesLength; ++m) {
                // [joint-matrix] = [node-to-root^-1][joint-to-root][inverse-bind][bind-shape]
                computedJointMatrices[m] = Matrix4.multiplyTransformation(scratchObjectSpace, joints[m].transformToRoot, computedJointMatrices[m]);
                computedJointMatrices[m] = Matrix4.multiplyTransformation(computedJointMatrices[m], inverseBindMatrices[m], computedJointMatrices[m]);
                if (defined(bindShapeMatrix)) {
                    // Optimization for when bind shape matrix is the identity.
                    computedJointMatrices[m] = Matrix4.multiplyTransformation(computedJointMatrices[m], bindShapeMatrix, computedJointMatrices[m]);
                }
            }
        }
    }

    function updatePickIds(model, context) {
        var id = model.id;
        if (model._id !== id) {
            model._id = id;

            var pickIds = model._pickIds;
            var length = pickIds.length;
            for (var i = 0; i < length; ++i) {
                context.getObjectByPickColor(pickIds[i].color).id = id;
            }
        }
    }

    function updateWireframe(model) {
        if (model._debugWireframe !== model.debugWireframe) {
            model._debugWireframe = model.debugWireframe;

            // This assumes the original primitive was TRIANGLES and that the triangles
            // are connected for the wireframe to look perfect.
            var primitiveType = model.debugWireframe ? PrimitiveType.LINES : PrimitiveType.TRIANGLES;
            var commands = model._renderCommands;
            var length = commands.length;

            for (var i = 0; i < length; ++i) {
                commands[i].primitiveType = primitiveType;
            }
        }
    }

    /**
     * @exception {RuntimeError} Failed to load external reference.
     *
     * @private
     */
    Model.prototype.update = function(context, frameState, commandList) {
        if (!this.show ||
            (frameState.mode !== SceneMode.SCENE3D)) {
            return;
        }

        if ((this._state === ModelState.NEEDS_LOAD) && defined(this.gltf)) {
            this._state = ModelState.LOADING;
            this._loadResources = new LoadResources();
            parse(this);
        }

        var justLoaded = false;

        if (this._state === ModelState.LOADING) {
            // Incrementally create WebGL resources as buffers/shaders/textures are downloaded
            createResources(this, context);

            var loadResources = this._loadResources;
            if (loadResources.finishedPendingLoads() && loadResources.finishedResourceCreation()) {
                this._state = ModelState.LOADED;
                this._loadResources = undefined;  // Clear CPU memory since WebGL resources were created.
                justLoaded = true;
            }
        }

        if (this._state === ModelState.LOADED) {
            var animated = this.activeAnimations.update(frameState) || this._cesiumAnimationsDirty;
            this._cesiumAnimationsDirty = false;

            // Model's model matrix needs to be updated
            var modelTransformChanged = !Matrix4.equals(this._modelMatrix, this.modelMatrix) || (this._scale !== this.scale);
            if (modelTransformChanged || justLoaded) {
                Matrix4.clone(this.modelMatrix, this._modelMatrix);
                this._scale = this.scale;
                Matrix4.multiplyByUniformScale(this.modelMatrix, this.scale, this._computedModelMatrix);
            }

            // Update modelMatrix throughout the graph as needed
            if (animated || modelTransformChanged || justLoaded) {
                updateNodeHierarchyModelMatrix(this, modelTransformChanged, justLoaded);

                if (animated || justLoaded) {
                    // Apply skins if animation changed any node transforms
                    applySkins(this);
                }
            }

            updatePickIds(this, context);
            updateWireframe(this);
        }

        if (justLoaded) {
            // Called after modelMatrix update.
            frameState.events.push({
                event : this.readyToRender,
                eventArguments : [this]
            });
            return;
        }

// TODO: make this not so wasteful
        var passes = frameState.passes;
        var i;
        var length;
        var commands;
        if (passes.render) {
            commands = this._renderCommands;
            length = commands.length;
            for (i = 0; i < length; ++i) {
                commandList.push(commands[i]);
            }
        }
        if (passes.pick) {
            commands = this._pickCommands;
            length = commands.length;
            for (i = 0; i < length; ++i) {
                commandList.push(commands[i]);
            }
        }
// END TODO
    };

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <br /><br />
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     *
     * @memberof Model
     *
     * @return {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
     *
     * @see Model#destroy
     */
    Model.prototype.isDestroyed = function() {
        return false;
    };

    function destroy(property) {
        for (var name in property) {
            if (property.hasOwnProperty(name)) {
                property[name].destroy();
            }
        }
    }

    /**
     * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
     * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
     * <br /><br />
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     *
     * @memberof Model
     *
     * @return {undefined}
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see Model#isDestroyed
     *
     * @example
     * model = model && model.destroy();
     */
    Model.prototype.destroy = function() {
        var resources = this._rendererResources;
        destroy(resources.buffers);
        destroy(resources.vertexArrays);
        destroy(resources.programs);
        destroy(resources.pickPrograms);
        destroy(resources.textures);
        resources = undefined;
        this._rendererResources = undefined;

        var pickIds = this._pickIds;
        var length = pickIds.length;
        for (var i = 0; i < length; ++i) {
            pickIds[i].destroy();
        }

        return destroyObject(this);
    };

    return Model;
});
